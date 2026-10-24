"""FFmpeg CPU codec yeteneklerini (H.265/libx265) algılar."""
import asyncio
import re
import time
from typing import Optional

FFMPEG_BIN = "ffmpeg"
ENCODER_LIST_TIMEOUT = 8.0
CACHE_SECONDS = 300.0

_cache: Optional[tuple[float, bool]] = None
_lock = asyncio.Lock()


async def _list_encoders() -> Optional[str]:
    """FFmpeg kodlayıcı listesini döndürür; ffmpeg yoksa/başarısızsa None."""
    try:
        process = await asyncio.create_subprocess_exec(
            FFMPEG_BIN,
            "-hide_banner",
            "-encoders",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except (FileNotFoundError, OSError):
        return None

    try:
        stdout, _ = await asyncio.wait_for(
            process.communicate(), timeout=ENCODER_LIST_TIMEOUT
        )
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        return None

    if process.returncode != 0:
        return None
    return stdout.decode("utf-8", errors="ignore")


async def detect_hevc_support(force: bool = False) -> bool:
    """FFmpeg derlemesinde libx265 varsa True döndürür.

    Sonuç kısa süreliğine önbelleğe alınır; yetenek uç noktası her açılışta
    FFmpeg'i yeniden çalıştırmaz.
    """
    global _cache
    now = time.time()
    if not force and _cache and now - _cache[0] < CACHE_SECONDS:
        return _cache[1]

    async with _lock:
        now = time.time()
        if not force and _cache and now - _cache[0] < CACHE_SECONDS:
            return _cache[1]

        text = await _list_encoders()
        available = bool(text and re.search(r"\blibx265\b", text))
        _cache = (time.time(), available)
        return available
