"""Ses dalga formu (waveform) çıkarımı ve önbelleği.

Tasarım notları:
- **Geçici ses dosyası oluşmaz**: FFmpeg ses akışını 8 kHz mono PCM olarak
  stdout'a yazar; biz akış halinde okuyup kova (bucket) başına tepe değeri
  çıkarırız. Diske yalnızca küçük JSON önbelleği yazılır (~2–8 KB).
- HLS kaynaklarında bant genişliğini düşürmek için master playlist'teki ses
  grubu (`EXT-X-MEDIA`) ya da en düşük bit hızlı varyant tercih edilir; dalga
  formu için sesin hangi varyanttan geldiği önemli değildir.
"""
import array
import asyncio
import base64
import hashlib
import json
import time
from typing import Any, Optional

from config import USER_AGENT, WAVEFORM_CACHE_DIR
from core.i18n import t
from services.hls import (
    find_audio_playlist,
    is_master_playlist,
    parse_playlist_variants,
    pick_lightest_variant,
)
from services.local_media import local_path
from services.request_headers import ffmpeg_input_args, header_fingerprint

SAMPLE_RATE = 8000
MIN_BUCKET_SECONDS = 0.25
MAX_BUCKETS = 8000
CHUNK_BYTES = 1 << 16
TIMEOUT_SECONDS = 150.0
CACHE_VERSION = 1
CACHE_TTL_DAYS = 30
# Sessiz bölümler de görünür olsun diye hafif log-benzeri ölçek (0 < x < 1)
PEAK_CURVE = 0.75

# Aynı anda tek çıkarım: kaynak değiştirilse bile kaynak tüketimi sınırlı kalır.
_extract_lock = asyncio.Lock()


class WaveformError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


class NoAudioError(WaveformError):
    """Kaynakta ses akışı yok (sessiz video): hata değil, dalga formu çizilmez."""


#: Sessiz kaynaklar için önbelleklenen yanıt (arayüz boş dalga formu çizer).
SILENT_PAYLOAD: dict[str, Any] = {
    "success": True,
    "bucket_seconds": MIN_BUCKET_SECONDS,
    "bucket_count": 0,
    "duration": 0.0,
    "buckets": "",
    "cached": False,
    "silent": True,
}


# ------------------------------------------------------------------ genel API
async def build_waveform(
    url: str,
    duration: float = 0.0,
    origin: Optional[str] = None,
    force: bool = False,
    client: Any = None,
    audio_url: Optional[str] = None,
    headers: Any = None,
) -> dict[str, Any]:
    """Kaynağın dalga formunu üretir (varsa önbellekten döner).

    `audio_url` verilirse doğrudan o akış kullanılır: YouTube gibi video akışı
    sessiz olan kaynaklarda sesin tek adresi budur. `headers` (curl ile gelen
    cookie/referer…) hem playlist isteğine hem FFmpeg'e aktarılır.
    """
    if not url:
        raise WaveformError(t("error.sourceEmpty"))

    if audio_url:
        source, optimized = audio_url, True
    else:
        source, optimized = await _select_source(client, origin, url, headers)
    fingerprint = header_fingerprint(headers)
    cache_key = hashlib.sha1(f"{CACHE_VERSION}|{fingerprint}|{source}".encode("utf-8")).hexdigest()

    if not force:
        cached = _read_cache(cache_key)
        if cached is not None:
            return {**cached, "cached": True, "optimized": optimized}

    async with _extract_lock:
        if not force:
            cached = _read_cache(cache_key)
            if cached is not None:
                return {**cached, "cached": True, "optimized": optimized}

        try:
            buckets, processed_seconds = await _extract(source, duration, headers)
        except NoAudioError:
            # Sessiz video: hata gösterme, boş dalga formu olarak önbellekle.
            payload = {**SILENT_PAYLOAD, "optimized": optimized}
            _write_cache(cache_key, payload)
            return payload

    if not buckets:
        raise WaveformError(t("error.waveformNoAudio"), status_code=422)

    bucket_seconds = _bucket_samples(processed_seconds) / SAMPLE_RATE
    payload = {
        "success": True,
        "bucket_seconds": round(bucket_seconds, 4),
        "bucket_count": len(buckets),
        "duration": round(processed_seconds, 3),
        "buckets": base64.b64encode(bytes(buckets)).decode("ascii"),
        "cached": False,
        "optimized": optimized,
    }
    _write_cache(cache_key, payload)
    return payload


# ------------------------------------------------------------------- kaynak
async def _select_source(
    client: Any, origin: Optional[str], url: str, headers: Any = None
) -> tuple[str, bool]:
    """Dalga formu için en ucuz kaynağı seçer (ses grubu ya da en düşük varyant)."""
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

        base_url = str(response.url)
        audio_only = find_audio_playlist(text, base_url)
        if audio_only:
            return audio_only, True

        lightest = pick_lightest_variant(parse_playlist_variants(text, base_url))
        if lightest:
            return str(lightest["url"]), True

    return url, False


# ----------------------------------------------------------------- çıkarım
def _bucket_samples(duration: float) -> int:
    """Kova başına örnek sayısı: ince çözünürlük, uzun kaynakta otomatik seyreltme."""
    samples = max(1, int(SAMPLE_RATE * MIN_BUCKET_SECONDS))
    if duration and duration > 0:
        samples = max(samples, int(duration * SAMPLE_RATE / MAX_BUCKETS))
    return samples


def _to_u8(peak: int) -> int:
    ratio = min(1.0, max(0.0, peak / 32768.0)) ** PEAK_CURVE
    return min(255, int(round(ratio * 255)))


async def _extract(url: str, duration: float, headers: Any = None) -> tuple[bytearray, float]:
    """FFmpeg ile PCM akışını okuyup kova tepe değerlerini döner."""
    bucket_samples = _bucket_samples(duration)
    # Yerel kaynak (/uploads/...) → dosya doğrudan okunur.
    source = str(local_path(url) or url)
    command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error"]
    if source.startswith(("http://", "https://")):
        command += ffmpeg_input_args(headers, USER_AGENT)
    command += [
        "-i", source,
        "-vn",
        "-map", "0:a:0?",
        "-ac", "1",
        "-ar", str(SAMPLE_RATE),
        "-f", "s16le",
        "pipe:1",
    ]

    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    assert process.stdout is not None and process.stderr is not None
    # stderr ayrı görevde tüketilmezse FFmpeg boru dolduğunda kilitlenebilir.
    stderr_task = asyncio.create_task(process.stderr.read())

    try:
        buckets, processed_seconds = await asyncio.wait_for(
            _consume_stream(process.stdout, bucket_samples),
            timeout=TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        _kill(process)
        raise WaveformError(
            t("error.waveformTimeout"),
            status_code=504,
        ) from None
    except asyncio.CancelledError:
        _kill(process)
        raise

    returncode = await process.wait()
    stderr = (await stderr_task).decode("utf-8", errors="ignore").strip()

    if returncode != 0 and not buckets:
        lowered = stderr.lower()
        if "does not contain any stream" in lowered or "matches no streams" in lowered:
            raise NoAudioError(t("error.waveformNoStream"))
        raise WaveformError(stderr[-400:] or t("error.waveformFailed"))

    return buckets, processed_seconds


async def _consume_stream(stream: Any, bucket_samples: int) -> tuple[bytearray, float]:
    """PCM akışını parça parça okuyup kova tepe değerlerine indirger."""
    buckets = bytearray()
    pending = b""
    peak = 0
    remaining = bucket_samples
    total_samples = 0

    while True:
        chunk = await stream.read(CHUNK_BYTES)
        if not chunk:
            break

        data = pending + chunk
        # Çift baytlık örnek sınırında kal: artan bayt bir sonraki parçaya taşınır
        extra = len(data) % 2
        pending = data[-1:] if extra else b""
        if extra:
            data = data[:-1]
        if not data:
            continue

        samples = array.array("h")
        samples.frombytes(data)
        total_samples += len(samples)

        start = 0
        total = len(samples)
        while start < total:
            take = min(remaining, total - start)
            window = samples[start:start + take]
            local = max(max(window), -min(window))
            if local > peak:
                peak = local
            start += take
            remaining -= take
            if remaining == 0:
                buckets.append(_to_u8(peak))
                peak = 0
                remaining = bucket_samples

    if remaining < bucket_samples and peak:
        buckets.append(_to_u8(peak))

    return buckets, total_samples / SAMPLE_RATE


def _kill(process: Any) -> None:
    try:
        process.kill()
    except Exception:
        pass


# ----------------------------------------------------------------- önbellek
def _cache_path(cache_key: str):
    return WAVEFORM_CACHE_DIR / f"{cache_key}.json"


def _read_cache(cache_key: str) -> Optional[dict[str, Any]]:
    path = _cache_path(cache_key)
    try:
        if not path.exists():
            return None
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, dict):
            return None
        # Sessiz kaynak yanıtı (boş buckets) da geçerli bir önbellek girdisidir.
        if not data.get("buckets") and not data.get("silent"):
            return None
        return data
    except Exception:
        return None


def _write_cache(cache_key: str, payload: dict[str, Any]) -> None:
    path = _cache_path(cache_key)
    try:
        WAVEFORM_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(".tmp")
        with temp.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, separators=(",", ":"))
        temp.replace(path)
    except Exception:
        return

    _purge_cache()


def _purge_cache() -> None:
    """Süresi geçen önbellek dosyalarını siler (varsayılan 30 gün)."""
    limit = time.time() - CACHE_TTL_DAYS * 86400
    try:
        for path in WAVEFORM_CACHE_DIR.glob("*.json"):
            try:
                if path.stat().st_mtime < limit:
                    path.unlink()
            except Exception:
                continue
    except Exception:
        return
