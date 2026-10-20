"""Hover önizlemesi için tek kare (JPEG) üretimi.

Video ilerletilmez: kare sunucuda, kaynağın kendisinden `-ss` ile çekilir.
- HLS'te master playlist varsa **en hafif varyant** kullanılır (küçük segment).
- Zaman 0,5 sn'lik kovalara yuvarlanır ve bellek içi LRU önbelleği tutulur,
  böylece aynı konum için tekrar FFmpeg süreci başlatılmaz.
"""
import asyncio
import hashlib
from collections import OrderedDict
from typing import Any, Optional

from config import USER_AGENT
from services.hls import is_master_playlist, parse_playlist_variants, pick_lightest_variant
from services.local_media import local_path
from services.request_headers import ffmpeg_input_args, header_fingerprint

WIDTH = 160
HEIGHT = 90
QUALITY = 5
TIME_BUCKET = 0.5
MAX_CACHE_ENTRIES = 300
TIMEOUT_SECONDS = 20.0
MAX_CONCURRENT = 2

#: sha1(url|zaman) → JPEG baytları
_cache: "OrderedDict[str, bytes]" = OrderedDict()
#: aynı kare için ikinci süreç başlatılmaması adına uçuştaki anahtarlar
_inflight: set[str] = set()
_semaphore = asyncio.Semaphore(MAX_CONCURRENT)


class FrameError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


async def build_frame(
    url: str,
    time: float,
    origin: Optional[str] = None,
    client: Any = None,
    headers: Any = None,
) -> bytes:
    """Belirtilen zamandaki kareyi JPEG olarak döner (önbellekli).

    `headers`: curl ile yapıştırılan HTTP başlıkları; kaynak gerektiriyorsa
    playlist ve FFmpeg isteklerine aktarılır.
    """
    if not url:
        raise FrameError("Kaynak adresi boş.")

    wanted = max(0.0, float(time or 0.0))
    source, _optimized = await _select_source(client, origin, url, headers)
    fingerprint = header_fingerprint(headers)
    key = hashlib.sha1(
        f"{fingerprint}|{source}|{round(wanted / TIME_BUCKET)}".encode("utf-8")
    ).hexdigest()

    cached = _cache.get(key)
    if cached is not None:
        _cache.move_to_end(key)
        return cached

    if key in _inflight:
        # Aynı kare zaten çıkarılıyor: kısa süre bekleyip sonuca bakılır
        for _ in range(50):
            await asyncio.sleep(0.1)
            hit = _cache.get(key)
            if hit is not None:
                return hit
        raise FrameError("Kare isteği kuyruğu dolu, biraz sonra tekrar deneyin.", status_code=429)

    _inflight.add(key)
    try:
        async with _semaphore:
            data = await _extract(source, wanted, headers)
    finally:
        _inflight.discard(key)

    _cache[key] = data
    _cache.move_to_end(key)
    while len(_cache) > MAX_CACHE_ENTRIES:
        _cache.popitem(last=False)

    return data


async def _select_source(
    client: Any, origin: Optional[str], url: str, headers: Any = None
) -> tuple[str, bool]:
    """Kare için en ucuz video kaynağını seçer (master varsa en hafif varyant)."""
    for candidate in (origin, url):
        if not isinstance(candidate, str) or ".m3u8" not in candidate.lower():
            continue
        if client is None:
            continue
        try:
            response = await client.get(candidate, headers=headers or None)
            response.raise_for_status()
            text = response.text
        except Exception:
            continue
        if not is_master_playlist(text):
            continue

        lightest = pick_lightest_variant(parse_playlist_variants(text, str(response.url)))
        if lightest:
            return str(lightest["url"]), True

    return url, False


async def _extract(source: str, time: float, headers: Any = None) -> bytes:
    """FFmpeg ile tek kare çeker (hızlı arama + tam kare hizası)."""
    # Yerel kaynak (/uploads/...) → dosya doğrudan okunur.
    source = str(local_path(source) or source)
    command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error"]
    if source.startswith(("http://", "https://")):
        command += ffmpeg_input_args(headers, USER_AGENT)
    command += [
        "-ss", f"{time:.3f}",
        "-i", source,
        "-frames:v", "1",
        "-vf",
        (
            f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,"
            f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2"
        ),
        "-q:v", str(QUALITY),
        "-f", "mjpeg",
        "pipe:1",
    ]

    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        _kill(process)
        raise FrameError("Kare çıkarımı zaman aşımına uğradı.", status_code=504) from None
    except asyncio.CancelledError:
        _kill(process)
        raise

    if process.returncode != 0 or not stdout:
        message = stderr.decode("utf-8", errors="ignore").strip()[-300:]
        raise FrameError(message or "Kare çıkarılamadı.")

    return stdout


def _kill(process: Any) -> None:
    try:
        process.kill()
    except Exception:
        pass
