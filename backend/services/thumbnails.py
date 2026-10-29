"""Galeri ve iş kartları için küçük, önbellekli thumbnail üretimi.

Thumbnail'lar export tamamlanınca bir kez üretilir; eski veya eksik dosyalar
için API ilk istekte üretip aynı önbelleğe yazar. Görseller en fazla 320 px
genişliğe indirilir; WebP desteklenmiyorsa JPEG'e düşülür.
"""
import hashlib
import logging
import subprocess
import threading
from pathlib import Path
from typing import Optional

from config import EXPORTS_DIR, THUMBNAIL_CACHE_DIR, VIDEO_EXTENSIONS

logger = logging.getLogger(__name__)

MAX_WIDTH = 320
WEBP_QUALITY = 72
JPEG_QUALITY = 4
TIMEOUT_SECONDS = 10
MAX_PARALLEL = 2

_EXTENSIONS = (".webp", ".jpg")
_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()
#: Kilit tablosu sınırlı tutulur: her export dosyası için bir kilit eklenip
#: hiç silinmezse uzun oturumda tablo sürekli büyür.
_LOCKS_LIMIT = 512
_GENERATION_SLOTS = threading.BoundedSemaphore(MAX_PARALLEL)
#: Kapaksız MP3'lerde her istekte yeniden FFmpeg çalıştırmamak için negatif cache.
_AUDIO_WITHOUT_COVER: set[str] = set()
_AUDIO_WITHOUT_COVER_GUARD = threading.Lock()
_AUDIO_WITHOUT_COVER_LIMIT = 512


class ThumbnailError(Exception):
    """Kaynak dosya okunamadı veya thumbnail üretilemedi."""


def _digest(name: str) -> str:
    return hashlib.sha256(name.encode("utf-8")).hexdigest()[:20]


def _lock_for(key: str) -> threading.Lock:
    with _LOCKS_GUARD:
        lock = _LOCKS.get(key)
        if lock is None:
            if len(_LOCKS) >= _LOCKS_LIMIT:
                # Yalnızca boşta olan kilitler atılır: tutulan bir kilidi
                # düşürmek aynı dosya için ikinci bir üretimi başlatırdı.
                idle = [name for name, item in _LOCKS.items() if not item.locked()]
                for stale in idle:
                    _LOCKS.pop(stale, None)
            lock = threading.Lock()
            _LOCKS[key] = lock
        return lock


def _source_stat(source: Path):
    try:
        stat = source.stat()
    except OSError as exc:
        raise ThumbnailError(f"source is not readable: {exc}") from exc
    if not source.is_file():
        raise ThumbnailError("source is not a file")
    return stat


def _cache_stem(source: Path, stat) -> str:
    # Dosya değişirse yeni anahtar oluşur; eski varyantlar temizlenir.
    return f"{_digest(source.name)}-{stat.st_size}-{stat.st_mtime_ns}"


def _cached_path(stem: str) -> Optional[Path]:
    for extension in _EXTENSIONS:
        candidate = THUMBNAIL_CACHE_DIR / f"{stem}{extension}"
        try:
            if candidate.is_file() and candidate.stat().st_size > 0:
                return candidate
        except OSError:
            continue
    return None


def _audio_without_cover(stem: str) -> bool:
    with _AUDIO_WITHOUT_COVER_GUARD:
        return stem in _AUDIO_WITHOUT_COVER


def _remember_audio_without_cover(stem: str) -> None:
    with _AUDIO_WITHOUT_COVER_GUARD:
        if len(_AUDIO_WITHOUT_COVER) >= _AUDIO_WITHOUT_COVER_LIMIT:
            _AUDIO_WITHOUT_COVER.clear()
        _AUDIO_WITHOUT_COVER.add(stem)


def _scale_filter() -> str:
    # Küçük kaynakları büyütme; genişliği 320 px ile sınırla, yüksekliği
    # çift sayıya yuvarla (JPEG kodlayıcıları için güvenli).
    return f"scale='min({MAX_WIDTH},iw)':-2:flags=lanczos"


def _thumbnail_command(
    source: Path, at_seconds: float, target: Path, codec: str
) -> list[str]:
    command = [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{at_seconds:.3f}",
        "-i",
        str(source),
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-an",
        "-sn",
        "-map_metadata",
        "-1",
        "-vf",
        _scale_filter(),
        "-threads",
        "1",
    ]
    if codec == "webp":
        command += [
            "-c:v",
            "libwebp",
            "-quality",
            str(WEBP_QUALITY),
            "-compression_level",
            "6",
        ]
    else:
        command += ["-c:v", "mjpeg", "-q:v", str(JPEG_QUALITY)]
    command += ["-y", str(target)]
    return command


def _generate(source: Path, stem: str) -> Optional[Path]:
    suffix = source.suffix.lower()
    # MP3'te kapak varsa 0. an; videolarda 1. sn daha temsilî, çok kısa
    # kliplerde ise ilk kareye geri düşülür.
    seek_times = [0.0] if suffix == ".mp3" else [1.0, 0.0]

    for at_seconds in seek_times:
        for extension, codec in ((".webp", "webp"), (".jpg", "jpeg")):
            target = THUMBNAIL_CACHE_DIR / f"{stem}{extension}"
            target.unlink(missing_ok=True)
            command = _thumbnail_command(source, at_seconds, target, codec)
            try:
                completed = subprocess.run(
                    command,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    timeout=TIMEOUT_SECONDS,
                    check=False,
                )
            except (OSError, subprocess.TimeoutExpired) as exc:
                logger.warning("thumbnail: ffmpeg çalıştırılamadı: %s", exc)
                target.unlink(missing_ok=True)
                return None

            try:
                valid = (
                    completed.returncode == 0
                    and target.is_file()
                    and target.stat().st_size > 0
                )
            except OSError:
                valid = False
            if valid:
                return target

            detail = completed.stderr.decode("utf-8", errors="ignore").strip()
            if detail:
                logger.debug("thumbnail: %s", detail[-300:])
            target.unlink(missing_ok=True)

    return None


def get_thumbnail(source: Path) -> Path:
    """Mevcut thumbnail'ı döndürür; yoksa üretip önbelleğe yazar."""
    source = Path(source)
    stat = _source_stat(source)
    stem = _cache_stem(source, stat)
    cached = _cached_path(stem)
    if cached is not None:
        return cached
    if source.suffix.lower() == ".mp3" and _audio_without_cover(stem):
        raise ThumbnailError("no embedded cover")

    key = _digest(source.name)
    with _lock_for(key):
        # FFmpeg beklerken dosya değişmiş veya başka istek üretmiş olabilir.
        stat = _source_stat(source)
        stem = _cache_stem(source, stat)
        cached = _cached_path(stem)
        if cached is not None:
            return cached
        if source.suffix.lower() == ".mp3" and _audio_without_cover(stem):
            raise ThumbnailError("no embedded cover")

        # Aynı anda çok sayıda galeri kartı açılırsa FFmpeg süreçlerini sınırla.
        with _GENERATION_SLOTS:
            generated = _generate(source, stem)
        if generated is None:
            if source.suffix.lower() == ".mp3":
                _remember_audio_without_cover(stem)
            raise ThumbnailError("thumbnail could not be generated")

        for stale in THUMBNAIL_CACHE_DIR.glob(f"{key}-*"):
            if stale != generated:
                try:
                    stale.unlink()
                except OSError:
                    pass
        return generated


def generate_thumbnail(source: Path) -> bool:
    """Export sonrası en iyi çaba; hata export'u etkilemez."""
    try:
        get_thumbnail(source)
        return True
    except ThumbnailError as exc:
        if Path(source).suffix.lower() == ".mp3":
            logger.debug("thumbnail: %s", exc)
        else:
            logger.warning("thumbnail: %s", exc)
    except Exception as exc:  # beklenmedik ffmpeg/disk hatası
        logger.warning("thumbnail: beklenmedik hata: %s", exc)
    return False


def delete_thumbnails(filename: str) -> None:
    """Silinen dosyanın tüm önbellek varyantlarını temizler."""
    key = _digest(filename)
    with _lock_for(key):
        for path in THUMBNAIL_CACHE_DIR.glob(f"{key}-*"):
            try:
                path.unlink()
            except OSError:
                pass
        with _AUDIO_WITHOUT_COVER_GUARD:
            for stem in list(_AUDIO_WITHOUT_COVER):
                if stem.startswith(f"{key}-"):
                    _AUDIO_WITHOUT_COVER.discard(stem)


def cleanup_thumbnails() -> int:
    """Süresi geçmiş veya kaynağı kalmamış thumbnail'ları temizler."""
    expected: set[str] = set()
    try:
        sources = list(EXPORTS_DIR.glob("*"))
    except OSError:
        sources = []

    for source in sources:
        if not source.is_file() or source.suffix.lower() not in VIDEO_EXTENSIONS:
            continue
        try:
            stat = source.stat()
        except OSError:
            continue
        stem = _cache_stem(source, stat)
        for extension in _EXTENSIONS:
            expected.add(f"{stem}{extension}")

    removed = 0
    try:
        candidates = list(THUMBNAIL_CACHE_DIR.glob("*"))
    except OSError:
        candidates = []
    for path in candidates:
        if path.suffix.lower() not in _EXTENSIONS or path.name in expected:
            continue
        try:
            path.unlink()
            removed += 1
        except OSError:
            pass
    return removed
