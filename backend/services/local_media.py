"""Yerel dosya kaynakları: yükleme, kopyasız seçim ve yol eşleme.

İki yol vardır:

1. **Kopyasız (Gözat):** Sunucu Windows'ta yerel dosya penceresini açar, seçilen
   dosyanın gerçek yolunu alır. Dosya hiçbir yere kopyalanmaz; oynatma ve
   dışa aktarma özgün dosyadan yapılır. Oynatma için rastgele bir jetonla
   `/api/local/file/<jeton>` adresi üretilir (jeton → yol eşlemesi bellekte).
   Yalnızca tarayıcının çalamayacağı bir kap (MKV/AVI/TS...) seçilirse, remux
   çıktısı `cache/uploads` içine yazılır (zorunlu türev dosya).

2. **Kopyalı (sürükle-bırak / tarayıcı seçicisi):** Tarayıcı güvenlik gereği
   dosyanın yolunu vermez, yalnızca içeriğini verir. Bu durumda dosya
   `cache/uploads/<token><uzantı>` adıyla geçici olarak saklanır.

Her iki durumda da ffmpeg/ffprobe yol eşlemesi `local_path()` üzerinden yapılır:
ne kopyalama ne de sunucunun kendisine ağ turu olur.
"""
import asyncio
import re
import secrets
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import unquote, urlparse

from config import (
    HOST,
    PORT,
    STREAMS_DIR,
    STREAMS_ROUTE,
    UPLOADS_DIR,
    UPLOADS_ROUTE,
)
from core.i18n import t

REMUX_TIMEOUT_SECONDS = 900.0
FILE_ROUTE = "/api/local/file"

#: Akış klasörü/adı doğrulaması (yol kaçırmayı engeller).
STREAM_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,64}")
STREAM_PLAYLIST = "index.m3u8"

#: Kullanıcının seçebileceği video uzantıları (tarayıcı `accept` ile aynı).
VIDEO_EXTENSIONS = {
    ".mp4",
    ".m4v",
    ".mov",
    ".webm",
    ".mkv",
    ".avi",
    ".ts",
    ".mts",
    ".m2ts",
    ".flv",
    ".wmv",
    ".3gp",
    ".ogv",
    ".mpg",
    ".mpeg",
}

#: Tarayıcının `<video>` ile çalabildiği kodekler.
BROWSER_VIDEO_CODECS = {"h264", "hevc", "vp8", "vp9", "av1"}
MP4_VIDEO_CODECS = {"h264", "hevc", "vp9", "av1"}
WEBM_VIDEO_CODECS = {"vp8", "vp9", "av1"}
BROWSER_AUDIO_CODECS = {"aac", "mp3", "opus", "vorbis", "flac"}

MP4_CONTAINER_EXTENSIONS = {".mp4", ".m4v", ".mov"}

#: Kopyasız kaynaklar: rastgele jeton → gerçek dosya yolu.
#: Sunucu yeniden başlatılırsa jetonlar geçersiz olur (kullanıcı yeniden seçer).
_FILE_REGISTRY: dict[str, Path] = {}

#: Süren remux süreci ve iptal bayrağı (yeni bir remux başlarken sıfırlanır).
_REMUX_PROCESS: Optional[asyncio.subprocess.Process] = None
_remux_cancelled = False


async def cancel_remux() -> bool:
    """Süren remux (kayıpsız dönüştürme) sürecini durdurur."""
    global _remux_cancelled

    process = _REMUX_PROCESS
    if process is None or process.returncode is not None:
        return False

    _remux_cancelled = True
    try:
        process.kill()
    except ProcessLookupError:
        return False
    except Exception:
        return False
    return True


class LocalFileError(Exception):
    """Yerel dosya hazırlanamadı (kullanıcıya gösterilebilir mesaj)."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


class LocalFileCancelled(LocalFileError):
    """Kullanıcı hazırlığı iptal etti (hata değil)."""

    def __init__(self, message: Optional[str] = None) -> None:
        super().__init__(message or t("error.cancelled"), status_code=409)


# ------------------------------------------------------------------ adresler
def upload_url(path: Path) -> str:
    """Yüklenen (kopyalanan) dosyanın tarayıcı adresi."""
    return f"http://{HOST}:{PORT}{UPLOADS_ROUTE}/{path.name}"


def register_local_file(path: Path) -> str:
    """Kopyasız kaynağı jetonla kaydeder; oynatma adresi için jeton döner."""
    token = secrets.token_hex(12)
    _FILE_REGISTRY[token] = path
    return token


def registered_file(token: str) -> Optional[Path]:
    """Jetonu dosya yoluna çevirir; dosya artık yoksa None döner."""
    path = _FILE_REGISTRY.get(token)
    if path is None:
        return None
    try:
        if not path.is_file():
            return None
    except OSError:
        return None
    return path


def file_url(token: str) -> str:
    return f"http://{HOST}:{PORT}{FILE_ROUTE}/{token}"


def local_path(value: str) -> Optional[Path]:
    """Yerel kaynak adresini gerçek dosya yoluna çevirir.

    Kabul edilen biçimler:
      `/uploads/<ad>`, `http://127.0.0.1:8765/uploads/<ad>` (kopyalanan dosya)
      `/api/local/file/<jeton>`, `http://127.0.0.1:8765/api/local/file/<jeton>`
      `/api/streams/<akış>/index.m3u8` (proje akışı playlist'i; ffmpeg'e sonlu
      `index.vod.m3u8` kopyası verilir)
    Diğer adreslerde (ve yol kaçırma denemelerinde) `None` döner; çağıran
    taraf özgün adresi kullanmaya devam eder.
    """
    if not isinstance(value, str) or not value.strip():
        return None

    text = value.strip()
    parsed = urlparse(text)
    if parsed.scheme in ("http", "https"):
        host = (parsed.hostname or "").lower()
        if host not in {"127.0.0.1", "localhost", HOST.lower()}:
            return None
        if parsed.port not in (None, PORT):
            return None
        route = parsed.path
    elif parsed.scheme:
        return None
    else:
        route = text

    route = unquote(route.split("?", 1)[0].split("#", 1)[0])

    # Proje akışı: playlist yerel dosya olarak okunur; segment adresleri
    # playlist'e göre göreceli olduğu için ffmpeg ağ turu yapmaz.
    stream_prefix = STREAMS_ROUTE.rstrip("/") + "/"
    if route.startswith(stream_prefix):
        parts = [part for part in route[len(stream_prefix):].split("/") if part]
        if len(parts) != 2:
            return None
        stream_id, file_name = parts
        if not STREAM_ID_PATTERN.fullmatch(stream_id):
            return None
        if file_name == STREAM_PLAYLIST:
            # Tarayıcı büyüyen EVENT listesini okur; ffmpeg/ffprobe ise sonlu
            # (`ENDLIST`) kopyayı okumalı, yoksa yayını hiç bitmez sanır.
            from services import streams as streams_service

            streams_service.ensure_playlists(stream_id)
            file_name = streams_service.VOD_PLAYLIST_FILE
        elif not re.fullmatch(r"seg_\d{6}\.ts", file_name):
            return None
        try:
            resolved = (STREAMS_DIR / stream_id / file_name).resolve()
            if resolved.parent != (STREAMS_DIR / stream_id).resolve():
                return None
            if not resolved.is_file():
                return None
        except OSError:
            return None
        return resolved

    file_prefix = FILE_ROUTE.rstrip("/") + "/"
    if route.startswith(file_prefix):
        token = route[len(file_prefix):].strip("/")
        if not token or "/" in token:
            return None
        return registered_file(token)

    prefix = UPLOADS_ROUTE.rstrip("/") + "/"
    if not route.startswith(prefix):
        return None

    name = Path(route[len(prefix):]).name
    if not name:
        return None

    try:
        resolved = (UPLOADS_DIR / name).resolve()
        if resolved.parent != UPLOADS_DIR.resolve() or not resolved.is_file():
            return None
    except OSError:
        return None
    return resolved


def safe_extension(file_name: str) -> str:
    return Path(file_name).suffix.lower()


def new_upload_path(file_name: str) -> Path:
    """Çakışmayan, güvenli bir hedef yol üretir (`<token><uzantı>`)."""
    return UPLOADS_DIR / f"{secrets.token_hex(8)}{safe_extension(file_name)}"


# ------------------------------------------------------------------- hazırlık
async def prepare_local_source(path: Path, original_name: str) -> dict[str, Any]:
    """Yüklenmiş (kopyalanmış) dosyayı analiz eder, gerekirse remux eder."""
    try:
        info = await _probe(path)
        playable, remuxed = await _make_playable(path, info)
    except LocalFileError:
        _discard(path)
        raise
    except Exception:
        _discard(path)
        raise
    return _describe(playable, info, original_name, upload_url(playable), remuxed, None)


async def prepare_picked_source(path: Path) -> dict[str, Any]:
    """Kopyasız seçilen dosyayı hazırlar (dosya yerinde kalır)."""
    try:
        if not path.exists() or not path.is_file():
            raise LocalFileError(t("error.fileNotFound"))
        if path.stat().st_size == 0:
            raise LocalFileError(t("error.fileEmpty"))
    except OSError as exc:
        raise LocalFileError(t("error.fileAccessFailed", detail=exc)) from None

    info = await _probe(path)
    playable, remuxed = await _make_playable(path, info)

    if playable == path:
        token = register_local_file(path)
        return _describe(path, info, path.name, file_url(token), False, str(path))

    # Remux gerektiyse türev dosya cache'e yazıldı; özgün dosya değişmedi.
    return _describe(playable, info, path.name, upload_url(playable), remuxed, str(path))


async def _probe(path: Path) -> dict[str, Any]:
    # Döngüsel içe aktarmayı önlemek için yerel içe aktarma (prober → local_media).
    from services.prober import ProbeError, probe_url

    try:
        info = await probe_url(str(path))
    except ProbeError as exc:
        raise LocalFileError(t("error.fileAnalyzeFailed", detail=exc)) from None

    if info["width"] <= 0 or info["height"] <= 0:
        raise LocalFileError(t("error.noPlayableVideo"))
    return info


async def _make_playable(path: Path, info: dict[str, Any]) -> tuple[Path, bool]:
    """Dosya olduğu gibi oynatılabiliyorsa aynen döner; değilse remux eder."""
    video_codec = str(info.get("codec") or "unknown")
    audio_codec = _audio_codec(info.get("raw") or {})
    target_kind = _remux_target(path.suffix.lower(), video_codec, audio_codec)

    if target_kind == "unsupported":
        raise LocalFileError(t("error.unsupportedCodec", codec=video_codec))
    if target_kind is None:
        return path, False

    target = path.with_suffix(f".{target_kind}") if path.parent == UPLOADS_DIR else (
        UPLOADS_DIR / f"{secrets.token_hex(8)}.{target_kind}"
    )
    await _remux(path, target, target_kind, audio_codec)
    if path.parent == UPLOADS_DIR:
        _discard(path)
    return target, True


def _describe(
    playable: Path,
    info: dict[str, Any],
    original_name: str,
    url: str,
    remuxed: bool,
    source_path: Optional[str],
) -> dict[str, Any]:
    size_bytes = playable.stat().st_size if playable.exists() else 0
    return {
        "success": True,
        "name": original_name,
        "url": url,
        #: Kopyasız kaynakta özgün dosya yolu (arayüzde gösterilir).
        "path": source_path,
        "width": int(info["width"]),
        "height": int(info["height"]),
        "duration": float(info["duration"]),
        "fps": float(info.get("fps") or 0),
        "has_audio": bool(info["has_audio"]),
        "size_bytes": size_bytes,
        "size_mb": round(size_bytes / (1024 * 1024), 2),
        "remuxed": remuxed,
    }


def _audio_codec(raw: dict[str, Any]) -> Optional[str]:
    for stream in raw.get("streams", []) or []:
        if stream.get("codec_type") == "audio":
            return str(stream.get("codec_name") or "unknown")
    return None


def _remux_target(
    extension: str, video_codec: str, audio_codec: Optional[str]
) -> Optional[str]:
    """None → dosya olduğu gibi oynatılabilir; "mp4"/"webm" → remux hedefi;
    "unsupported" → tarayıcı bu video kodeğini hiç çalamaz."""
    if video_codec not in BROWSER_VIDEO_CODECS:
        return "unsupported"

    audio_ok = audio_codec is None or audio_codec in BROWSER_AUDIO_CODECS
    if extension in MP4_CONTAINER_EXTENSIONS:
        direct = video_codec in MP4_VIDEO_CODECS and audio_ok
    elif extension == ".webm":
        direct = video_codec in WEBM_VIDEO_CODECS and audio_ok
    else:
        direct = False  # mkv / avi / ts / flv / wmv ... tarayıcı kabı desteklemez

    if direct:
        return None
    if video_codec in WEBM_VIDEO_CODECS:
        return "webm"
    if video_codec in MP4_VIDEO_CODECS:
        return "mp4"
    return "unsupported"


async def _remux(
    source: Path, target: Path, kind: str, audio_codec: Optional[str]
) -> None:
    """Görüntüyü yeniden kodlamadan (kayıpsız) tarayıcı kabına taşır."""
    global _REMUX_PROCESS, _remux_cancelled

    command = [
        "ffmpeg",
        "-y",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(source),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-c:v",
        "copy",
    ]

    if audio_codec is None:
        pass
    elif kind == "mp4" and audio_codec in {"aac", "mp3"}:
        command += ["-c:a", "copy"]
    elif kind == "webm" and audio_codec in {"opus", "vorbis"}:
        command += ["-c:a", "copy"]
    elif kind == "mp4":
        command += ["-c:a", "aac", "-b:a", "192k"]
    else:
        command += ["-c:a", "libopus", "-b:a", "160k"]

    if kind == "mp4":
        command += ["-movflags", "+faststart"]
    command.append(str(target))

    _remux_cancelled = False
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _REMUX_PROCESS = process

    try:
        _, stderr = await asyncio.wait_for(
            process.communicate(), timeout=REMUX_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError:
        try:
            process.kill()
        except Exception:
            pass
        target.unlink(missing_ok=True)
        raise LocalFileError(t("error.remuxTimeout")) from None
    finally:
        if _REMUX_PROCESS is process:
            _REMUX_PROCESS = None

    if _remux_cancelled:
        target.unlink(missing_ok=True)
        raise LocalFileCancelled(t("error.remuxCancelled"))

    if process.returncode != 0 or not target.exists() or target.stat().st_size == 0:
        target.unlink(missing_ok=True)
        message = stderr.decode("utf-8", errors="ignore").strip()[-300:]
        detail = message or t("error.remuxUnknown")
        raise LocalFileError(t("error.remuxFailed", detail=detail))


def _discard(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


# -------------------------------------------------------------------- temizlik
def cleanup_uploads(max_age_days: int = 7) -> int:
    """Bir haftadan eski geçici dosyaları siler (sunucu açılışında çağrılır)."""
    cutoff = time.time() - max_age_days * 86400
    removed = 0
    try:
        items = list(UPLOADS_DIR.iterdir())
    except OSError:
        return 0
    for item in items:
        try:
            if item.is_file() and item.stat().st_mtime < cutoff:
                item.unlink()
                removed += 1
        except OSError:
            continue
    return removed
