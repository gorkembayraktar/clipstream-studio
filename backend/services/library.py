"""exports/ klasöründeki dosyaların listelenmesi, silinmesi ve gezginde açılması."""
import os
import subprocess
import sys
import time
from pathlib import Path

from config import EXPORTS_DIR, VIDEO_EXTENSIONS
from core.i18n import t
from services.prober import probe_url
from services.thumbnails import delete_thumbnails


class LibraryError(Exception):
    """Geçersiz dosya işlemi."""


# ffprobe pahalıdır; aynı dosya sürümü için sonucu süreç belleğinde tut.
# Anahtar: çözümlenmiş yol, değer: ((mtime_ns, size), metadata).
_META_CACHE: dict[str, tuple[tuple[int, int], dict]] = {}
_META_CACHE_LIMIT = 128


def resolve_file(filename: str) -> Path:
    """Güvenli çözümleme: alt klasöre kaçışları (..\\, /) reddeder."""
    if not filename or Path(filename).name != filename:
        raise LibraryError(t("error.invalidFileName"))

    target = (EXPORTS_DIR / filename).resolve()
    if target.parent != EXPORTS_DIR.resolve() or not target.is_file():
        raise LibraryError(t("error.fileNotFound"))
    return target


def list_files() -> list[dict]:
    files: list[dict] = []
    for path in EXPORTS_DIR.glob("*"):
        if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS:
            stat = path.stat()
            files.append({
                "name": path.name,
                "size_mb": round(stat.st_size / (1024 * 1024), 2),
                "modified": stat.st_mtime,
                "modified_str": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(stat.st_mtime)),
                "url": f"/exports/{path.name}",
            })
    files.sort(key=lambda item: item["modified"], reverse=True)
    return files


async def get_file_meta(filename: str) -> dict:
    """Tek bir galeri dosyasını ffprobe ile analiz eder ve sonucu önbelleğe alır.

    Liste uç noktası her dosyayı probe etmez; bu çağrı yalnızca kullanıcı bir
    dosyayı önizlediğinde yapılır. Önbellek `mtime + boyut` ile geçersizleşir.
    """
    target = resolve_file(filename)
    try:
        stat = target.stat()
    except OSError as exc:
        raise LibraryError(t("error.fileAccessFailed", detail=exc)) from exc

    signature = (stat.st_mtime_ns, stat.st_size)
    cache_key = str(target)
    cached = _META_CACHE.get(cache_key)
    if cached and cached[0] == signature:
        return {**cached[1], "cached": True}

    meta = await probe_url(cache_key)
    result = {
        "success": True,
        "name": target.name,
        "duration": meta.get("duration", 0),
        "width": meta.get("width", 0),
        "height": meta.get("height", 0),
        "fps": meta.get("fps", 0),
        "codec": meta.get("codec", "unknown"),
        "has_audio": bool(meta.get("has_audio")),
        "has_video": bool(meta.get("has_video")),
        "format_name": meta.get("format_name", ""),
        "size_bytes": stat.st_size,
        "size_mb": round(stat.st_size / (1024 * 1024), 2),
        "cached": False,
    }

    if len(_META_CACHE) >= _META_CACHE_LIMIT:
        _META_CACHE.clear()
    _META_CACHE[cache_key] = (signature, result)
    return result


def delete_file(filename: str) -> None:
    target = resolve_file(filename)
    try:
        target.unlink()
    except OSError as exc:
        raise LibraryError(t("error.deleteFailed", detail=exc)) from exc
    _META_CACHE.pop(str(target), None)
    delete_thumbnails(target.name)


def reveal_in_explorer(filename: str | None = None) -> str:
    if sys.platform != "win32":
        raise LibraryError(t("error.windowsOnly"))

    if filename:
        target = resolve_file(filename)
        subprocess.Popen(f'explorer /select,"{target}"')
        return t("message.revealSelected", name=filename)

    os.startfile(str(EXPORTS_DIR.resolve()))  # noqa: S606  (Windows'a özel)
    return t("message.exportsOpened")
