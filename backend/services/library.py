"""exports/ klasöründeki dosyaların listelenmesi, silinmesi ve gezginde açılması."""
import os
import subprocess
import sys
import time
from pathlib import Path

from config import EXPORTS_DIR, VIDEO_EXTENSIONS
from core.i18n import t


class LibraryError(Exception):
    """Geçersiz dosya işlemi."""


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


def delete_file(filename: str) -> None:
    target = resolve_file(filename)
    try:
        target.unlink()
    except OSError as exc:
        raise LibraryError(t("error.deleteFailed", detail=exc)) from exc


def reveal_in_explorer(filename: str | None = None) -> str:
    if sys.platform != "win32":
        raise LibraryError(t("error.windowsOnly"))

    if filename:
        target = resolve_file(filename)
        subprocess.Popen(f'explorer /select,"{target}"')
        return t("message.revealSelected", name=filename)

    os.startfile(str(EXPORTS_DIR.resolve()))  # noqa: S606  (Windows'a özel)
    return t("message.exportsOpened")
