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
import logging
import math
import time
from contextlib import aclosing
from typing import Any, AsyncIterator, Optional

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
from services.segment_downloader import (
    DownloadedMedia,
    HlsDownloadError,
    download_hls_media,
    iter_hls_chunks,
    load_hls_playlist,
)

SAMPLE_RATE = 8000
MIN_BUCKET_SECONDS = 0.25
MAX_BUCKETS = 8000
CHUNK_BYTES = 1 << 16
TIMEOUT_SECONDS = 150.0
CACHE_VERSION = 1
CACHE_TTL_DAYS = 30

# Uzun kaynaklarda tek FFmpeg süreci saatlerce sesi baştan sona çözer. Bunun
# yerine dosyayı zaman aralıklarına bölüp birden çok FFmpeg ile paralel
# çözüyoruz; her aralığın kova tepe değerleri `max` ile birleştirilir.
WAVEFORM_CHUNK_SECONDS = 300.0          # 5 dakikalık parçalar
WAVEFORM_DECODE_CONCURRENCY = 6         # aynı anda 6 FFmpeg
CHUNK_TIMEOUT_SECONDS = 120.0           # tek 5 dakikalık parça için üst sınır
PARALLEL_EXTRACT_TIMEOUT_SECONDS = 600.0
MIN_PARALLEL_SECONDS = 600.0            # 10 dakikadan kısa kaynakta tek süreç

logger = logging.getLogger(__name__)
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
    audio_track: Optional[str] = None,
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
    cache_key = _cache_key(source, origin, headers, audio_track)

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
            buckets, processed_seconds = await _extract(source, duration, headers, client)
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


# -------------------------------------------------------- kademeli çıkarım
def _start_event_for(
    duration: float,
    bucket_seconds: float,
    bucket_count: int,
    optimized: bool,
    cached: bool,
    silent: bool = False,
) -> dict[str, Any]:
    return {
        "type": "start",
        "duration": round(duration, 3),
        "bucket_seconds": round(bucket_seconds, 4),
        "bucket_count": bucket_count,
        "optimized": optimized,
        "cached": cached,
        "silent": silent,
    }


def _done_event(
    payload: dict[str, Any],
    optimized: bool,
    cached: bool,
) -> dict[str, Any]:
    return {
        "type": "done",
        "success": True,
        "duration": payload.get("duration", 0.0),
        "bucket_seconds": payload.get("bucket_seconds", MIN_BUCKET_SECONDS),
        "bucket_count": payload.get("bucket_count", 0),
        "cached": cached,
        "optimized": optimized,
        "silent": bool(payload.get("silent")),
    }


def _finalize_payload(
    buckets: bytearray,
    duration: float,
    optimized: bool,
    cached: bool = False,
) -> dict[str, Any]:
    bucket_seconds = _bucket_samples(duration) / SAMPLE_RATE
    return {
        "success": True,
        "bucket_seconds": round(bucket_seconds, 4),
        "bucket_count": len(buckets),
        "duration": round(duration, 3),
        "buckets": base64.b64encode(bytes(buckets)).decode("ascii"),
        "cached": cached,
        "optimized": optimized,
    }


async def _events_from_payload(
    payload: dict[str, Any],
    optimized: bool,
    cached: bool,
) -> AsyncIterator[dict[str, Any]]:
    """Tam (önbellekten gelen) yanıtı aynı akış olaylarına çevirir."""
    silent = bool(payload.get("silent"))
    yield _start_event_for(
        float(payload.get("duration") or 0.0),
        float(payload.get("bucket_seconds") or MIN_BUCKET_SECONDS),
        int(payload.get("bucket_count") or 0),
        optimized,
        cached,
        silent,
    )
    if not silent and payload.get("buckets"):
        yield {
            "type": "chunk",
            "index": 0,
            "start": 0,
            "count": int(payload.get("bucket_count") or 0),
            "buckets": payload["buckets"],
        }
    yield _done_event(payload, optimized, cached)


def _chunk_event(
    index: int,
    peaks: dict[int, int],
    all_buckets: bytearray,
) -> Optional[dict[str, Any]]:
    """Bir parçanın tepe değerlerini global kova aralığına yerleştirir."""
    if not peaks or not all_buckets:
        return None
    low = max(0, min(peaks))
    high = min(len(all_buckets) - 1, max(peaks))
    if low > high:
        return None

    payload = bytearray(high - low + 1)
    for bucket_index in range(low, high + 1):
        value = _to_u8(peaks.get(bucket_index, 0))
        payload[bucket_index - low] = value
        if value > all_buckets[bucket_index]:
            all_buckets[bucket_index] = value

    return {
        "type": "chunk",
        "index": index,
        "start": low,
        "count": len(payload),
        "buckets": base64.b64encode(bytes(payload)).decode("ascii"),
    }


async def _stream_hls(
    client: Any,
    playlist: Any,
    headers: Any,
    optimized: bool,
    cache_key: str,
) -> AsyncIterator[dict[str, Any]]:
    duration = float(playlist.duration)
    bucket_samples = _bucket_samples(duration)
    bucket_count = max(
        1, int(math.ceil(duration * SAMPLE_RATE / bucket_samples))
    )
    all_buckets = bytearray(bucket_count)
    started = time.perf_counter()
    sent = 0

    async with aclosing(
        iter_hls_chunks(client, playlist, headers)
    ) as chunks:
        async for chunk in chunks:
            peaks = await _peaks_for_range(
                str(chunk.path),
                0.0,
                chunk.duration,
                bucket_samples,
                offset=chunk.start,
            )
            if sent == 0:
                yield _start_event_for(
                    duration,
                    bucket_samples / SAMPLE_RATE,
                    bucket_count,
                    optimized,
                    False,
                )
            event = _chunk_event(chunk.index, peaks, all_buckets)
            if event is not None:
                yield event
            sent += 1
            if sent == 1:
                logger.info(
                    "waveform: ilk kademeli parça %.1f sn'de hazır",
                    time.perf_counter() - started,
                )

    if sent == 0:
        return

    payload = _finalize_payload(all_buckets, duration, optimized)
    _write_cache(cache_key, payload)
    yield _done_event(payload, optimized, False)


async def _stream_uncached(
    source: str,
    duration: float,
    headers: Any,
    client: Any,
    optimized: bool,
    cache_key: str,
) -> AsyncIterator[dict[str, Any]]:
    playlist = None
    if client is not None and source.startswith(("http://", "https://")):
        playlist = await load_hls_playlist(client, source, headers)

    if playlist is not None and playlist.duration > 0:
        started = False
        try:
            async for event in _stream_hls(
                client, playlist, headers, optimized, cache_key
            ):
                if event.get("type") == "start":
                    started = True
                yield event
            if started:
                return
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            if started:
                yield {
                    "type": "error",
                    "error": str(exc) or t("error.waveformFailed"),
                    "status_code": getattr(exc, "status_code", 500),
                }
                return
            logger.warning(
                "waveform: kademeli akış başlatılamadı, tek çıktıya dönülüyor: %s",
                exc,
            )

    # HLS değil, şifreli/canlı ya da kademeli akış başlayamadı: mevcut yol.
    buckets, processed_seconds = await _extract(
        source, duration, headers, client
    )
    if not buckets:
        raise NoAudioError(t("error.waveformNoStream"))

    payload = _finalize_payload(buckets, processed_seconds, optimized)
    _write_cache(cache_key, payload)
    yield _start_event_for(
        payload["duration"],
        payload["bucket_seconds"],
        payload["bucket_count"],
        optimized,
        False,
    )
    yield {
        "type": "chunk",
        "index": 0,
        "start": 0,
        "count": payload["bucket_count"],
        "buckets": payload["buckets"],
    }
    yield _done_event(payload, optimized, False)


async def stream_waveform(
    url: str,
    duration: float = 0.0,
    origin: Optional[str] = None,
    force: bool = False,
    client: Any = None,
    audio_url: Optional[str] = None,
    audio_track: Optional[str] = None,
    headers: Any = None,
) -> AsyncIterator[dict[str, Any]]:
    """Waveform'u NDJSON olayları olarak üretir (kademeli çizim için)."""
    if not url:
        yield {
            "type": "error",
            "error": t("error.sourceEmpty"),
            "status_code": 400,
        }
        return

    try:
        if audio_url:
            source, optimized = audio_url, True
        else:
            source, optimized = await _select_source(client, origin, url, headers)
        cache_key = _cache_key(source, origin, headers, audio_track)

        if not force:
            cached = _read_cache(cache_key)
            if cached is not None:
                async for event in _events_from_payload(cached, optimized, True):
                    yield event
                return

        async with _extract_lock:
            if not force:
                cached = _read_cache(cache_key)
                if cached is not None:
                    async for event in _events_from_payload(
                        cached, optimized, True
                    ):
                        yield event
                    return

            try:
                async for event in _stream_uncached(
                    source, duration, headers, client, optimized, cache_key
                ):
                    yield event
            except NoAudioError:
                payload = {**SILENT_PAYLOAD, "optimized": optimized}
                _write_cache(cache_key, payload)
                async for event in _events_from_payload(
                    payload, optimized, False
                ):
                    yield event
            except WaveformError as exc:
                yield {
                    "type": "error",
                    "error": str(exc),
                    "status_code": exc.status_code,
                }
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("waveform: kademeli akış hatası")
                yield {
                    "type": "error",
                    "error": t("error.waveformFailed"),
                    "status_code": 500,
                }
    except asyncio.CancelledError:
        raise
    except WaveformError as exc:
        yield {
            "type": "error",
            "error": str(exc),
            "status_code": exc.status_code,
        }
    except Exception:
        logger.exception("waveform: akış başlatma hatası")
        yield {
            "type": "error",
            "error": t("error.waveformFailed"),
            "status_code": 500,
        }


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


def _peaks_from_pcm(
    data: bytes,
    bucket_samples: int,
    start_sample: int,
) -> dict[int, int]:
    """PCM baytlarını kova indekslerine göre tepe değerlerine indirger.

    `start_sample`, bu PCM parçasının toplam zaman çizgisindeki başlangıcıdır.
    Böylece 5 dakikalık parçalar birbirinden bağımsız çözülse de kova sınırları
    genel ses süresine göre hizalanır. Bir kova iki parçaya bölünürse iki
    parçanın tepe değerlerinden büyüğü geçerlidir.
    """
    if bucket_samples <= 0 or len(data) < 2:
        return {}
    if len(data) % 2:
        data = data[:-1]

    samples = array.array("h")
    samples.frombytes(data)
    if not samples:
        return {}

    peaks: dict[int, int] = {}
    index = start_sample // bucket_samples
    remaining = bucket_samples - (start_sample % bucket_samples)
    start = 0
    total = len(samples)

    while start < total:
        take = min(remaining, total - start)
        window = samples[start:start + take]
        local = max(max(window), -min(window))
        if index not in peaks or local > peaks[index]:
            peaks[index] = local
        start += take
        remaining -= take
        if remaining == 0:
            index += 1
            remaining = bucket_samples

    return peaks


async def _peaks_for_range(
    source: str,
    start: float,
    length: float,
    bucket_samples: int,
    offset: Optional[float] = None,
) -> dict[int, int]:
    """Kaynağın bir zaman aralığını FFmpeg ile çözüp kova tepelerini döner.

    `offset`, aralığın toplam zaman çizgisindeki başlangıcıdır. Kademeli
    indirmede dosya kendi başından çözülürken doğru global kova indeksini
    hesaplamak için kullanılır.
    """
    command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error"]
    if start > 0:
        # Girdi tarafında arama: FFmpeg baştan çözüp atmaz, hedefe atlar.
        command += ["-ss", f"{start:.3f}"]
    command += [
        "-i", source,
        "-t", f"{length:.3f}",
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

    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=CHUNK_TIMEOUT_SECONDS,
        )
    except (asyncio.TimeoutError, asyncio.CancelledError):
        _kill(process)
        raise

    if process.returncode != 0 and not stdout:
        text = stderr.decode("utf-8", errors="ignore").strip()
        lowered = text.lower()
        if "does not contain any stream" in lowered or "matches no streams" in lowered:
            raise NoAudioError(t("error.waveformNoStream"))
        raise WaveformError(text[-400:] or t("error.waveformFailed"))

    return _peaks_from_pcm(
        stdout,
        bucket_samples,
        int(round((start if offset is None else offset) * SAMPLE_RATE)),
    )


async def _extract_parallel(source: str, duration: float) -> tuple[bytearray, float]:
    """Uzun sesi 5 dakikalık parçalar halinde paralel çözüp tepeleri birleştirir."""
    bucket_samples = _bucket_samples(duration)
    chunk_count = max(1, math.ceil(duration / WAVEFORM_CHUNK_SECONDS))
    logger.info(
        "waveform: %.0f sn ses, %d parça, %d paralel FFmpeg",
        duration,
        chunk_count,
        WAVEFORM_DECODE_CONCURRENCY,
    )

    semaphore = asyncio.Semaphore(WAVEFORM_DECODE_CONCURRENCY)

    async def run(index: int) -> dict[int, int]:
        start = index * WAVEFORM_CHUNK_SECONDS
        length = min(WAVEFORM_CHUNK_SECONDS, duration - start)
        if length <= 0:
            return {}
        async with semaphore:
            return await _peaks_for_range(source, start, length, bucket_samples)

    tasks = [asyncio.create_task(run(index)) for index in range(chunk_count)]
    try:
        results = await asyncio.wait_for(
            asyncio.gather(*tasks),
            timeout=PARALLEL_EXTRACT_TIMEOUT_SECONDS,
        )
    except asyncio.CancelledError:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise
    except Exception:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise

    merged: dict[int, int] = {}
    for result in results:
        for index, peak in result.items():
            if index not in merged or peak > merged[index]:
                merged[index] = peak

    expected = max(1, int(math.ceil(duration * SAMPLE_RATE / bucket_samples)))
    buckets = bytearray(expected)
    for index, peak in merged.items():
        if 0 <= index < expected:
            buckets[index] = _to_u8(peak)

    return buckets, duration


async def _extract(
    url: str,
    duration: float,
    headers: Any = None,
    client: Any = None,
) -> tuple[bytearray, float]:
    """FFmpeg ile PCM akışını okuyup kova tepe değerlerini döner.

    Uzun HLS VOD'larında kaynak önce paralel segment indiriciyle yerelleştirilir;
    böylece yüzlerce küçük isteğin gecikmesi FFmpeg'in önüne set çekmez. Kaynak
    yerelleştikten sonra ses 5 dakikalık aralıklarla paralel çözülür.
    """
    # Yerel kaynak (/uploads/...) → dosya doğrudan okunur.
    source = str(local_path(url) or url)
    download: Optional[DownloadedMedia] = None
    if client is not None and source.startswith(("http://", "https://")):
        download = await download_hls_media(client, source, headers)
        if download is not None:
            source = str(download.path)

    total_duration = duration
    if download is not None and download.duration > 0:
        total_duration = download.duration
    bucket_samples = _bucket_samples(total_duration)

    try:
        if download is not None and total_duration >= MIN_PARALLEL_SECONDS:
            try:
                buckets, processed_seconds = await _extract_parallel(
                    source, total_duration
                )
                if buckets:
                    return buckets, processed_seconds
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                # Paralel çözüm başarısız olursa aynı yerel dosyayı tek FFmpeg
                # ile denemek, uzak akışa dönmekten daha hızlı ve güvenlidir.
                logger.warning("waveform: paralel çözüm başarısız: %s", exc)

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
    finally:
        # Waveform üretildi; indirilen ses/video parçaları geride kalmamalı.
        if download is not None:
            download.cleanup()


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
def _cache_key(
    source: str,
    origin: Optional[str],
    headers: Any,
    audio_track: Optional[str] = None,
) -> str:
    """Önbellek anahtarı: CDN'in ürettiği geçici yolu değil, kullanıcının
    girdiği kaynağı (`origin`) esas alır. Böylece master her açılışta farklı
    bir CDN yolu döndürse de aynı video önbellekten gelir.

    Alternatif ses rendition'ı seçildiğinde `audio_track` anahtara eklenir;
    aksi halde farklı diller aynı dalga formu önbelleğini paylaşırdı.
    """
    stable = origin or source
    if audio_track:
        stable = f"{stable}|audio:{audio_track}"
    return hashlib.sha1(
        f"{CACHE_VERSION}|{header_fingerprint(headers)}|{stable}".encode("utf-8")
    ).hexdigest()


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
