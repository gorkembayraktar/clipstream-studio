"""HLS medya playlist'ini paralel indirip yerel bir dosyada birleştirir.

Neden: Dalga formu için FFmpeg bir HLS playlist'ini baştan sona sırayla okur.
Sunucu her küçük segment için 1-2 saniye gecikme yaşatırsa 2,5 saatlik bir ses
akışı 871 ayrı istek demektir ve 150 saniyelik çıkarım süresi kolayca aşılır.
Segmentler eşzamanlı indirilip sırayla birleştirildiğinde aynı gecikme duvarı
aşılır; FFmpeg dosyayı yerelden hızla okur.

Kurallar:
- Yalnızca sonlu (VOD / `EXT-X-ENDLIST`) medya playlist'leri indirilir.
- Şifreli (`EXT-X-KEY`) veya byte-range'li playlist'lerde güvenli tarafta
  kalınır; çağıran taraf mevcut FFmpeg akışına döner.
- Geçici klasör iş bitince (hata/iptal dahil) silinir.
"""
import asyncio
import logging
import re
import shutil
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncIterator, Optional
from urllib.parse import urljoin, urlparse

from config import WAVEFORM_TEMP_DIR
from services.hls import ATTRIBUTE, is_master_playlist

logger = logging.getLogger(__name__)

#: Eşzamanlı segment isteği sayısı. CDN'lerin 429/403 dönmesini önlemek için
#: ayarlanabilir; 15, yüksek gecikmeli sunucularda belirgin kazanç sağlar.
SEGMENT_CONCURRENCY = 15
SEGMENT_RETRIES = 3
SEGMENT_TIMEOUT = 30.0
DOWNLOAD_TIMEOUT_SECONDS = 180.0
#: Playlist için en fazla okunacak bayt. Doğrudan video URL'si verilse bile
#: tüm dosyayı belleğe almadan HLS olup olmadığını anlamaya yeter.
MAX_PLAYLIST_BYTES = 1 << 20

EXTINF = re.compile(r"#EXTINF:(?P<duration>[0-9.]+)")
MAP_TAG = re.compile(r"#EXT-X-MAP:(?P<attrs>.+)")
KEY_TAG = re.compile(r"#EXT-X-KEY:(?P<attrs>.+)")


@dataclass
class MediaSegment:
    url: str
    duration: float = 0.0


@dataclass
class MediaPlaylist:
    segments: list[MediaSegment]
    duration: float
    init_url: Optional[str] = None
    encrypted: bool = False
    byterange: bool = False
    endlist: bool = False


@dataclass
class DownloadedMedia:
    """İndirilmiş ve birleştirilmiş geçici medya dosyası."""

    path: Path
    temp_dir: Path
    duration: float
    segment_count: int
    #: Dosyanın kaynak zaman çizgisindeki başlangıcı (sn).
    start: float = 0.0

    def cleanup(self) -> None:
        """Geçici klasörü (birleşik dosya ve parçalar) siler."""
        shutil.rmtree(self.temp_dir, ignore_errors=True)


@dataclass
class DownloadedChunk:
    """Kademeli waveform için indirilip birleştirilmiş zaman aralığı."""

    index: int
    path: Path
    start: float
    duration: float
    segment_count: int

    def cleanup(self) -> None:
        try:
            self.path.unlink()
        except OSError:
            pass


class HlsDownloadError(RuntimeError):
    """Segment indirme/a birleştirme hatası (çağıran taraf geri düşebilir)."""


def _attributes(value: str) -> dict[str, str]:
    return {
        item.group("key"): item.group("value").strip('"')
        for item in ATTRIBUTE.finditer(value)
    }


def parse_media_playlist(text: str, base_url: str) -> Optional[MediaPlaylist]:
    """Medya playlist'ini okur; master/canlı/geçersiz playlist'te None döner."""
    if not text or "#EXTM3U" not in text or is_master_playlist(text):
        return None

    segments: list[MediaSegment] = []
    init_url: Optional[str] = None
    encrypted = False
    byterange = False
    endlist = False
    pending_duration = 0.0

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("#EXTINF:"):
            match = EXTINF.match(line)
            if match:
                try:
                    pending_duration = float(match.group("duration"))
                except ValueError:
                    pending_duration = 0.0
            continue
        if line.startswith("#EXT-X-MAP:"):
            attrs = _attributes(line)
            uri = attrs.get("URI")
            if uri:
                init_url = urljoin(base_url, uri)
            if attrs.get("BYTERANGE"):
                byterange = True
            continue
        if line.startswith("#EXT-X-KEY:"):
            attrs = _attributes(line)
            if (attrs.get("METHOD") or "NONE").upper() != "NONE":
                encrypted = True
            continue
        if line.startswith("#EXT-X-BYTERANGE"):
            byterange = True
            continue
        if line.startswith("#EXT-X-ENDLIST"):
            endlist = True
            continue
        if line.startswith("#"):
            continue

        segments.append(
            MediaSegment(url=urljoin(base_url, line), duration=pending_duration)
        )
        pending_duration = 0.0

    if not segments:
        return None

    return MediaPlaylist(
        segments=segments,
        duration=sum(segment.duration for segment in segments),
        init_url=init_url,
        encrypted=encrypted,
        byterange=byterange,
        endlist=endlist,
    )


_DIRECT_MEDIA_SUFFIXES = (
    ".mp4",
    ".webm",
    ".mkv",
    ".mov",
    ".m4v",
    ".mp3",
    ".m4a",
    ".aac",
    ".wav",
    ".gif",
    ".ogg",
)


def _probably_media_file(url: str) -> bool:
    """Doğrudan medya dosyasıysa playlist indirme denemesini atlar."""
    path = urlparse(url).path.lower()
    return path.endswith(_DIRECT_MEDIA_SUFFIXES)


async def load_hls_playlist(
    client: Any,
    playlist_url: str,
    headers: Optional[dict[str, str]] = None,
) -> Optional[MediaPlaylist]:
    """Playlist'i indirir; yalnızca güvenle indirilebilir VOD ise döner.

    Doğrudan video URL'si verilirse tüm dosya belleğe alınmaz; playlist
    olup olmadığını anlamaya yetecek kadar (en fazla 1 MB) okunur.
    """
    if client is None or _probably_media_file(playlist_url):
        return None

    try:
        async with client.stream(
            "GET", playlist_url, headers=headers or None
        ) as response:
            response.raise_for_status()
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) >= MAX_PLAYLIST_BYTES:
                    break
            base_url = str(getattr(response, "url", None) or playlist_url)
        text = bytes(body).decode("utf-8", errors="replace")
    except Exception as exc:
        logger.info("hls: playlist alınamadı: %s", exc)
        return None

    playlist = parse_media_playlist(text, base_url)
    if playlist is None:
        logger.info("hls: medya playlist değil, doğrudan FFmpeg kullanılacak")
        return None
    if not playlist.endlist:
        logger.info("hls: canlı playlist, doğrudan FFmpeg kullanılacak")
        return None
    if playlist.encrypted:
        logger.info("hls: şifreli playlist, doğrudan FFmpeg kullanılacak")
        return None
    if playlist.byterange:
        logger.info("hls: byte-range playlist, doğrudan FFmpeg kullanılacak")
        return None
    return playlist


async def _fetch_to_file(
    client: Any,
    url: str,
    destination: Path,
    headers: Optional[dict[str, str]],
) -> None:
    """Tek bir segmenti diske indirir; hatalı/boş yanıtta yeniden dener."""
    last_error: Optional[Exception] = None
    for attempt in range(SEGMENT_RETRIES):
        try:
            async with client.stream(
                "GET",
                url,
                headers=headers or None,
                timeout=SEGMENT_TIMEOUT,
            ) as response:
                if response.status_code >= 400:
                    raise RuntimeError(f"HTTP {response.status_code}")
                with destination.open("wb") as handle:
                    async for chunk in response.aiter_bytes():
                        handle.write(chunk)
            if destination.stat().st_size <= 0:
                raise RuntimeError("boş segment")
            return
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - yeniden deneme sınırına kadar
            last_error = exc
            if attempt + 1 < SEGMENT_RETRIES:
                await asyncio.sleep(0.4 * (2 ** attempt))
    raise RuntimeError(f"segment indirilemedi: {url}") from last_error


def _merge_parts(parts: list[Path], destination: Path) -> None:
    with destination.open("wb") as output:
        for part in parts:
            with part.open("rb") as source:
                shutil.copyfileobj(source, output, length=1 << 20)


async def download_hls_media(
    client: Any,
    playlist_url: str,
    headers: Optional[dict[str, str]] = None,
    *,
    concurrency: int = SEGMENT_CONCURRENCY,
    temp_root: Path = WAVEFORM_TEMP_DIR,
) -> Optional[DownloadedMedia]:
    """VOD HLS medya playlist'ini paralel indirir; uygun değilse None döner.

    None döndüğünde çağıran taraf URL'yi doğrudan FFmpeg'e vermeye devam eder.
    Başarıda dönen `DownloadedMedia` çağıran tarafından `cleanup()` ile silinmelidir.
    """
    if client is None:
        return None

    playlist = await load_hls_playlist(client, playlist_url, headers)
    if playlist is None:
        return None

    temp_root.mkdir(parents=True, exist_ok=True)
    temp_dir = Path(tempfile.mkdtemp(prefix="wf-", dir=temp_root))
    parts: list[Path] = []
    merged = temp_dir / "media.bin"
    started = time.perf_counter()
    logger.info(
        "hls: %d segment (%.0f sn) %d eşzamanlı istekle indiriliyor",
        len(playlist.segments),
        playlist.duration,
        concurrency,
    )

    try:
        semaphore = asyncio.Semaphore(max(1, concurrency))
        completed = 0

        async def fetch(index: int, url: str, *, init: bool = False) -> Path:
            nonlocal completed
            name = "init.bin" if init else f"part-{index:06d}.bin"
            destination = temp_dir / name
            async with semaphore:
                await _fetch_to_file(client, url, destination, headers)
            completed += 1
            if completed % 100 == 0:
                logger.info(
                    "hls: %d/%d segment indirildi",
                    completed,
                    len(playlist.segments),
                )
            return destination

        tasks: list[asyncio.Task[Path]] = []
        if playlist.init_url:
            tasks.append(asyncio.create_task(fetch(0, playlist.init_url, init=True)))
        tasks.extend(
            asyncio.create_task(fetch(index, segment.url))
            for index, segment in enumerate(playlist.segments)
        )

        try:
            parts = list(
                await asyncio.wait_for(
                    asyncio.gather(*tasks),
                    timeout=DOWNLOAD_TIMEOUT_SECONDS,
                )
            )
        except asyncio.CancelledError:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise
        except Exception:
            # Zaman aşımı ya da segment hatası: bekleyen istekleri durdur,
            # yarım kalan dosyaları bırakma ve FFmpeg doğrudan yoluna dön.
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            logger.warning(
                "hls: indirme başarısız (%.1f sn), doğrudan FFmpeg'e dönülüyor",
                time.perf_counter() - started,
            )
            shutil.rmtree(temp_dir, ignore_errors=True)
            return None

        _merge_parts(parts, merged)
        # Birleştirme bitti; parça dosyalarına artık gerek yok.
        for part in parts:
            try:
                part.unlink()
            except OSError:
                pass

        logger.info(
            "hls: %d segment %.1f sn'de indirildi (%.1f MB)",
            len(playlist.segments),
            time.perf_counter() - started,
            merged.stat().st_size / (1024 * 1024),
        )
        return DownloadedMedia(
            path=merged,
            temp_dir=temp_dir,
            duration=playlist.duration,
            segment_count=len(playlist.segments),
        )
    except asyncio.CancelledError:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    except Exception as exc:
        # İndirme başarısızsa geçici dosyaları bırakma; FFmpeg doğrudan yola döner.
        logger.warning(
            "hls: indirme hatası (%.1f sn): %s",
            time.perf_counter() - started,
            exc,
        )
        shutil.rmtree(temp_dir, ignore_errors=True)
        return None


def _segment_window(
    playlist: MediaPlaylist,
    start: float,
    end: float,
    padding: float = 2.0,
) -> Optional[tuple[float, float, list[MediaSegment]]]:
    """İstenen klip aralığını kapsayan segmentleri seçer.

    Sondaki `padding`, B-karelerin/kenar karelerin çözülebilmesi için bir
    sonraki segmentin de indirilmesini sağlar.
    """
    if playlist.duration <= 0 or end <= start:
        return None

    start = max(0.0, start)
    limit = end + max(0.0, padding)
    selected: list[MediaSegment] = []
    window_start: Optional[float] = None
    cumulative = 0.0

    for segment in playlist.segments:
        duration = max(0.0, segment.duration)
        segment_start = cumulative
        segment_end = cumulative + duration
        if segment_end > start and segment_start < limit:
            if window_start is None:
                window_start = segment_start
            selected.append(segment)
        cumulative = segment_end

    if not selected or window_start is None:
        return None

    window_duration = sum(max(0.0, segment.duration) for segment in selected)
    return window_start, window_duration, selected


async def download_hls_range(
    client: Any,
    playlist_url: str,
    start: float,
    end: float,
    headers: Optional[dict[str, str]] = None,
    *,
    concurrency: int = SEGMENT_CONCURRENCY,
    temp_root: Path = WAVEFORM_TEMP_DIR,
) -> Optional[DownloadedMedia]:
    """HLS medya playlist'inden yalnızca klip aralığını indirir.

    Dışa aktarmada FFmpeg'in AV1/fMP4 HLS seek sorununu aşmak için kullanılır:
    FFmpeg uzak playlist yerine, istenen aralığı içeren yerel bir dosyayı okur.
    Uygun olmayan playlist'te `None` döner ve çağıran eski yola devam eder.
    """
    if client is None:
        return None

    playlist = await load_hls_playlist(client, playlist_url, headers)
    if playlist is None:
        return None

    window = _segment_window(playlist, start, end)
    if window is None:
        return None
    window_start, window_duration, segments = window

    temp_root.mkdir(parents=True, exist_ok=True)
    temp_dir = Path(tempfile.mkdtemp(prefix="wf-", dir=temp_root))
    merged = temp_dir / "range.bin"
    started = time.perf_counter()
    logger.info(
        "hls: dışa aktarma aralığı indiriliyor (%.1f-%.1f sn, %d segment)",
        window_start,
        window_start + window_duration,
        len(segments),
    )

    try:
        init_path: Optional[Path] = None
        if playlist.init_url:
            init_path = temp_dir / "init.bin"
            await _fetch_to_file(client, playlist.init_url, init_path, headers)

        semaphore = asyncio.Semaphore(max(1, concurrency))

        async def fetch(index: int, url: str) -> Path:
            destination = temp_dir / f"range-{index:06d}.bin"
            async with semaphore:
                await _fetch_to_file(client, url, destination, headers)
            return destination

        tasks = [
            asyncio.create_task(fetch(index, segment.url))
            for index, segment in enumerate(segments)
        ]
        try:
            parts = list(
                await asyncio.wait_for(
                    asyncio.gather(*tasks),
                    timeout=DOWNLOAD_TIMEOUT_SECONDS,
                )
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
            shutil.rmtree(temp_dir, ignore_errors=True)
            logger.warning(
                "hls: dışa aktarma aralığı indirilemedi (%.1f sn)",
                time.perf_counter() - started,
            )
            return None

        _merge_parts(([init_path] if init_path is not None else []) + parts, merged)
        for part in parts:
            try:
                part.unlink()
            except OSError:
                pass

        logger.info(
            "hls: aralık %.1f sn'de indirildi (%.1f MB)",
            time.perf_counter() - started,
            merged.stat().st_size / (1024 * 1024),
        )
        return DownloadedMedia(
            path=merged,
            temp_dir=temp_dir,
            duration=window_duration,
            segment_count=len(segments),
            start=window_start,
        )
    except asyncio.CancelledError:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(temp_dir, ignore_errors=True)
        logger.warning("hls: aralık indirme hatası: %s", exc)
        return None


def _group_segments(
    playlist: MediaPlaylist,
    chunk_seconds: float,
) -> list[tuple[float, float, list[MediaSegment]]]:
    """Segmentleri yaklaşık `chunk_seconds`'lik ardışık gruplara böler."""
    groups: list[tuple[float, float, list[MediaSegment]]] = []
    current: list[MediaSegment] = []
    current_duration = 0.0
    start = 0.0

    for segment in playlist.segments:
        current.append(segment)
        current_duration += segment.duration
        if current_duration >= chunk_seconds:
            groups.append((start, current_duration, current))
            start += current_duration
            current = []
            current_duration = 0.0

    if current:
        groups.append((start, current_duration, current))
    return groups


async def _download_group(
    client: Any,
    index: int,
    start: float,
    duration: float,
    segments: list[MediaSegment],
    temp_dir: Path,
    init_path: Optional[Path],
    headers: Optional[dict[str, str]],
    concurrency: int,
) -> DownloadedChunk:
    """Bir zaman aralığının segmentlerini paralel indirip tek dosyada birleştirir."""
    semaphore = asyncio.Semaphore(max(1, concurrency))

    async def fetch(part_index: int, url: str) -> Path:
        destination = temp_dir / f"g{index:04d}-p{part_index:05d}.bin"
        async with semaphore:
            await _fetch_to_file(client, url, destination, headers)
        return destination

    tasks = [
        asyncio.create_task(fetch(part_index, segment.url))
        for part_index, segment in enumerate(segments)
    ]

    try:
        parts = list(
            await asyncio.wait_for(
                asyncio.gather(*tasks),
                timeout=DOWNLOAD_TIMEOUT_SECONDS,
            )
        )
    except asyncio.CancelledError:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise
    except Exception as exc:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise HlsDownloadError(
            f"parça {index + 1} indirilemedi: {exc}"
        ) from exc

    merged = temp_dir / f"chunk-{index:04d}.bin"
    try:
        _merge_parts(([init_path] if init_path is not None else []) + parts, merged)
    finally:
        for part in parts:
            try:
                part.unlink()
            except OSError:
                pass

    return DownloadedChunk(
        index=index,
        path=merged,
        start=start,
        duration=duration,
        segment_count=len(segments),
    )


async def iter_hls_chunks(
    client: Any,
    playlist: MediaPlaylist,
    headers: Optional[dict[str, str]] = None,
    *,
    chunk_seconds: float = 300.0,
    concurrency: int = SEGMENT_CONCURRENCY,
    temp_root: Path = WAVEFORM_TEMP_DIR,
) -> AsyncIterator[DownloadedChunk]:
    """VOD playlist'ini zaman sırasıyla indirilmiş parçalar halinde üretir.

    Bir sonraki parçanın indirmesi, mevcut parça çözülürken arka planda başlar.
    Dönen `DownloadedChunk` yalnızca bir sonraki parça istenene kadar geçerlidir;
    tüketici dosyayı hemen işlemeli ve generator kapanırken temizlik otomatiktir.
    """
    if (
        client is None
        or playlist is None
        or not playlist.endlist
        or playlist.encrypted
        or playlist.byterange
        or not playlist.segments
    ):
        return

    groups = _group_segments(playlist, max(30.0, chunk_seconds))
    if not groups:
        return

    temp_root.mkdir(parents=True, exist_ok=True)
    temp_dir = Path(tempfile.mkdtemp(prefix="wf-", dir=temp_root))
    init_path: Optional[Path] = None
    next_task: Optional[asyncio.Task[DownloadedChunk]] = None
    started = time.perf_counter()

    try:
        if playlist.init_url:
            init_path = temp_dir / "init.bin"
            await _fetch_to_file(client, playlist.init_url, init_path, headers)

        def start_group(group_index: int) -> asyncio.Task[DownloadedChunk]:
            group_start, group_duration, group_segments = groups[group_index]
            return asyncio.create_task(
                _download_group(
                    client,
                    group_index,
                    group_start,
                    group_duration,
                    group_segments,
                    temp_dir,
                    init_path,
                    headers,
                    concurrency,
                )
            )

        next_task = start_group(0)
        for index in range(len(groups)):
            chunk = await next_task
            next_task = start_group(index + 1) if index + 1 < len(groups) else None
            logger.info(
                "hls: parça %d/%d hazır (%.0f-%.0f sn, %.1f MB)",
                index + 1,
                len(groups),
                chunk.start,
                chunk.start + chunk.duration,
                chunk.path.stat().st_size / (1024 * 1024),
            )
            try:
                yield chunk
            finally:
                chunk.cleanup()
    except asyncio.CancelledError:
        raise
    except HlsDownloadError:
        raise
    except Exception as exc:
        raise HlsDownloadError(str(exc)) from exc
    finally:
        if next_task is not None:
            if not next_task.done():
                next_task.cancel()
            await asyncio.gather(next_task, return_exceptions=True)
        shutil.rmtree(temp_dir, ignore_errors=True)
        logger.info(
            "hls: kademeli indirme kapandı (%.1f sn)",
            time.perf_counter() - started,
        )


def cleanup_stale_temp_dirs(max_age_hours: int = 24) -> None:
    """Çökme/kesinti sonrası kalan geçici indirme klasörlerini temizler."""
    cutoff = time.time() - max_age_hours * 3600
    try:
        for path in WAVEFORM_TEMP_DIR.glob("wf-*"):
            try:
                if path.is_dir() and path.stat().st_mtime < cutoff:
                    shutil.rmtree(path, ignore_errors=True)
            except OSError:
                continue
    except OSError:
        return
