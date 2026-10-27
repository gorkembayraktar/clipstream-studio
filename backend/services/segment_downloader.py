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
from core.i18n import t
from services.hls import (
    ATTRIBUTE,
    MAX_PLAYLIST_BYTES,
    detect_hls,
    is_master_playlist,
    select_best_variant,
)

logger = logging.getLogger(__name__)

#: Eşzamanlı segment isteği sayısı. CDN'lerin 429/403 dönmesini önlemek için
#: ayarlanabilir; 15, yüksek gecikmeli sunucularda belirgin kazanç sağlar.
SEGMENT_CONCURRENCY = 15
SEGMENT_RETRIES = 3
SEGMENT_TIMEOUT = 30.0
DOWNLOAD_TIMEOUT_SECONDS = 180.0
#: Uzantısız doğrudan medya URL'lerini HLS sanıp 1 MB okumadan önce yapılan
#: hızlı tespit için üst sınır. Ağ yavaşsa FFmpeg'in doğrudan yoluna dönülür.
HLS_DETECT_TIMEOUT_SECONDS = 12.0

EXTINF = re.compile(r"#EXTINF:(?P<duration>[0-9.]+)")
MAP_TAG = re.compile(r"#EXT-X-MAP:(?P<attrs>.+)")
KEY_TAG = re.compile(r"#EXT-X-KEY:(?P<attrs>.+)")
MEDIA_SEQUENCE = re.compile(r"#EXT-X-MEDIA-SEQUENCE:(?P<value>\d+)")
TARGET_DURATION = re.compile(r"#EXT-X-TARGETDURATION:(?P<value>[0-9.]+)")


@dataclass
class MediaSegment:
    url: str
    duration: float = 0.0
    #: Medya sırası (`EXT-X-MEDIA-SEQUENCE` + index). Canlı/DVR penceresinde
    #: segmentin kayar pencere içindeki kararlı kimliğidir; zaman eşlemesi
    #: duvar saati yerine bu numaraya dayanır.
    sequence: Optional[int] = None


@dataclass
class MediaPlaylist:
    segments: list[MediaSegment]
    duration: float
    init_url: Optional[str] = None
    encrypted: bool = False
    byterange: bool = False
    endlist: bool = False
    #: Segmentler arasında PTS sıfırlanması/init değişimi varsa true.
    discontinuity: bool = False
    #: İlk segmentin medya sırası (`EXT-X-MEDIA-SEQUENCE`, yoksa 0).
    media_sequence: int = 0
    target_duration: float = 0.0
    #: Playlist'in (yönlendirmelerden sonraki) adresi. Kayıt/yeniden kullanım
    #: için master çözümlemesini tekrar yapmamak adına saklanır.
    url: str = ""


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
class DownloadedSegments:
    """Storyboard için seçilmiş HLS segmentlerinin yerel kopyaları."""

    temp_dir: Path
    paths: dict[int, Path]
    starts: dict[int, float]
    durations: dict[int, float]

    def cleanup(self) -> None:
        """Geçici segment klasörünü siler."""
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
    discontinuity = False
    media_sequence = 0
    target_duration = 0.0
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
        if line.startswith("#EXT-X-MEDIA-SEQUENCE:"):
            match = MEDIA_SEQUENCE.match(line)
            if match:
                media_sequence = int(match.group("value"))
            continue
        if line.startswith("#EXT-X-TARGETDURATION:"):
            match = TARGET_DURATION.match(line)
            if match:
                try:
                    target_duration = float(match.group("value"))
                except ValueError:
                    target_duration = 0.0
            continue
        if line.startswith("#EXT-X-MAP:"):
            attrs = _attributes(line)
            uri = attrs.get("URI")
            if uri:
                resolved = urljoin(base_url, uri)
                # Aynı playlist içinde init bölümü değişirse segmentleri
                # tek bir init ile ham olarak birleştirmek geçersiz olur.
                if init_url is not None and resolved != init_url:
                    discontinuity = True
                init_url = resolved
            if attrs.get("BYTERANGE"):
                byterange = True
            continue
        if line == "#EXT-X-DISCONTINUITY":
            # Ham byte birleştirme PTS sıfırlamasını taşımaz; bu playlist'te
            # FFmpeg'in HLS demuxer'ına dönmek gerekir.
            discontinuity = True
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
            MediaSegment(
                url=urljoin(base_url, line),
                duration=pending_duration,
                sequence=media_sequence + len(segments),
            )
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
        discontinuity=discontinuity,
        media_sequence=media_sequence,
        target_duration=target_duration,
        url=base_url,
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
    *,
    allow_live: bool = False,
) -> Optional[MediaPlaylist]:
    """Playlist'i indirir; yalnızca güvenle indirilebilir VOD ise döner.

    Doğrudan video URL'si verilirse tüm dosya belleğe alınmaz; playlist
    olup olmadığını anlamaya yetecek kadar (en fazla 1 MB) okunur.

    `allow_live=True` yalnızca sınırlı bir zaman aralığını indiren dışa
    aktarma yolunda kullanılır: 24 saatlik DVR penceresi gibi `ENDLIST`
    taşımayan playlist'lerde de segment listesi geçerlidir. Dalga formu /
    storyboard gibi tüm playlist'i indiren çağıranlar varsayılan (VOD only)
    davranışı korumalıdır.
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
    if not playlist.endlist and not allow_live:
        logger.info("hls: canlı playlist, doğrudan FFmpeg kullanılacak")
        return None
    if playlist.encrypted:
        logger.info("hls: şifreli playlist, doğrudan FFmpeg kullanılacak")
        return None
    if playlist.byterange:
        logger.info("hls: byte-range playlist, doğrudan FFmpeg kullanılacak")
        return None
    return playlist


async def load_export_playlist(
    client: Any,
    playlist_url: str,
    headers: Optional[dict[str, str]] = None,
) -> Optional[MediaPlaylist]:
    """Dışa aktarma için medya playlist'i (canlı/DVR penceresi dahil).

    Master playlist verilirse en iyi varyantın medya playlist'ine inilir.
    """
    playlist = await load_hls_playlist(
        client, playlist_url, headers, allow_live=True
    )
    if playlist is None:
        variant = await select_best_variant(client, playlist_url, headers)
        variant_url = str((variant or {}).get("url") or "").strip()
        if variant_url and variant_url != playlist_url:
            playlist = await load_hls_playlist(
                client, variant_url, headers, allow_live=True
            )
    return playlist


class LiveTimelineError(RuntimeError):
    """İstemci zaman çizelgesi güncel canlı pencereyle eşleştirilemedi."""


def segment_offset(playlist: MediaPlaylist, sequence: int) -> Optional[float]:
    """Verilen medya sırasının pencere içindeki başlangıcı (sn).

    Segment hâlâ penceredeyse başlangıç, yoksa `None` döner.
    """
    cursor = 0.0
    for segment in playlist.segments:
        if segment.sequence is None:
            continue
        if segment.sequence == sequence:
            return cursor
        cursor += max(0.0, segment.duration)
    return None


def _parse_anchor(anchor: Any) -> tuple[Optional[int], Optional[float]]:
    """İstemcinin bildirdiği `{sequence, time}` bağlantı noktasını okur."""
    if not isinstance(anchor, dict):
        return None, None
    try:
        sequence = int(anchor.get("sequence"))
        time = float(anchor.get("time"))
    except (TypeError, ValueError):
        return None, None
    if sequence < 0 or not time == time:  # NaN kontrolü
        return None, None
    return sequence, max(0.0, time)


async def live_timeline_shift(
    client: Any,
    playlist_url: str,
    anchor: Any,
    headers: Optional[dict[str, str]] = None,
    *,
    start: Optional[float] = None,
    end: Optional[float] = None,
) -> tuple[float, Optional[MediaPlaylist]]:
    """Dışa aktarma anında uygulanacak zaman kaymasını (sn) hesaplar.

    Oynatıcı (hls.js) zaman çizelgesini ilk okuduğu playlist'te sıfırlar ve
    pencere kaydıkça bu çizgiyi büyütmeye devam eder. Dışa aktarma ise
    playlist'i yeniden okur; bu yüzden FFmpeg'in `-ss` değeri ve segment
    eşlemesi **güncel** pencere başına göre yapılır.

    `anchor`, istemci zaman çizelgesinde bilinen bir noktadır:
    `{"sequence": <medya sırası>, "time": <o segmentin başladığı çizelge sn>}`.
    Kayma = segmentin güncel penceredeki başlangıcı - `time`. Bağlantı noktası
    klibin kendisinden seçildiği için pencere kayması onu geçersiz kılmaz;
    yalnızca klip pencereden tamamen çıktıysa hata verilir.

    Dönüş: `(kayma, playlist_anlık_görüntüsü)`. VOD kaynaklarda ya da bağlantı
    noktası yoksa `(0.0, None)` döner. Dönen playlist indirme adımına
    geçirilmelidir: pencere her birkaç saniyede kaydığı için kaymanın
    hesaplandığı anlık görüntü ile indirilen segmentler aynı olmalıdır.
    """
    sequence, anchor_time = _parse_anchor(anchor)
    if client is None or sequence is None or anchor_time is None:
        return 0.0, None

    playlist = await load_export_playlist(client, playlist_url, headers)
    if playlist is None or playlist.endlist:
        return 0.0, None

    offset = segment_offset(playlist, sequence)
    if offset is None:
        raise LiveTimelineError(t("error.liveWindowExpired"))

    shift = offset - anchor_time
    if start is not None and start + shift < 0:
        raise LiveTimelineError(t("error.liveWindowExpired"))
    if end is not None and end + shift > playlist.duration + 0.001:
        raise LiveTimelineError(t("error.liveWindowExpired"))
    return shift, playlist


def locate_segment(
    playlist: MediaPlaylist, at: float
) -> Optional[tuple[int, float]]:
    """Kaynak zamanını (segment indeksi, segment içi ofset) olarak döner.

    Storyboard kareleri seyrek seçildiği için her kare için yalnızca ilgili
    segment indirilir. Zaman playlist sonunun ötesindeyse son segmentin son
    karesine kelepçelenir.
    """
    if not playlist.segments:
        return None

    total = sum(max(0.0, segment.duration) for segment in playlist.segments)
    if total <= 0:
        return None
    at = max(0.0, min(float(at), total - 0.001))

    cursor = 0.0
    for index, segment in enumerate(playlist.segments):
        duration = max(0.0, segment.duration)
        if at < cursor + duration or index == len(playlist.segments) - 1:
            return index, max(0.0, at - cursor)
        cursor += duration
    return None


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


async def _remux_parts_with_ffmpeg(
    temp_dir: Path,
    init_path: Optional[Path],
    parts: list[Path],
    segments: list[MediaSegment],
) -> Optional[Path]:
    """İndirilen parçaları yerel HLS playlist'i üzerinden tek MP4'e remux eder.

    Ham byte birleştirme, segmentlerin PTS sıfırlamalarını veya farklı init
    bölümlerini taşımaz. FFmpeg'in HLS demuxer'ı parçaları sırayla okuyup
    zaman damgalarını normalize eder; başarısız olursa çağıran taraf ham
    birleştirmeye döner.

    Çıktı MPEG-TS değil MP4'tür: YouTube HLS varyantları VP9/AV1 olabilir ve
    MPEG-TS bu kodekleri taşıyamadığı için video ``bin_data`` akışına dönüşür.
    MP4 hem VP9/AV1 hem de H.264/HEVC'yi korur; dışa aktarma aşaması da hedef
    biçim olarak MP4 kullanır.
    """
    if not parts:
        return None

    playlist_path = temp_dir / "local.m3u8"
    merged = temp_dir / "merged.mp4"
    max_duration = max(
        (max(0.0, item.duration) for item in segments), default=0.0
    )
    target_duration = max(1, int(max_duration) + 1)
    lines = [
        "#EXTM3U",
        "#EXT-X-VERSION:7",
        "#EXT-X-PLAYLIST-TYPE:VOD",
        f"#EXT-X-TARGETDURATION:{target_duration}",
        "#EXT-X-MEDIA-SEQUENCE:0",
    ]
    if init_path is not None:
        lines.append(f'#EXT-X-MAP:URI="{init_path.name}"')
    for part, segment in zip(parts, segments):
        lines.append(f"#EXTINF:{max(0.0, segment.duration):.6f},")
        lines.append(part.name)
    lines.append("#EXT-X-ENDLIST")
    playlist_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    command = [
        "ffmpeg",
        "-y",
        "-nostdin",
        "-nostats",
        "-loglevel",
        "error",
        "-allowed_extensions",
        "ALL",
        "-protocol_whitelist",
        "file,crypto,data",
        "-fflags",
        "+genpts",
        "-i",
        playlist_path.name,
        "-map",
        "0:v:0?",
        "-map",
        "0:a:0?",
        "-c",
        "copy",
        "-avoid_negative_ts",
        "make_zero",
        "-f",
        "mp4",
        merged.name,
    ]

    process = None
    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=str(temp_dir),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(
                process.communicate(), timeout=180.0
            )
        except asyncio.TimeoutError:
            try:
                process.kill()
            except Exception:
                pass
            await process.wait()
            logger.info("hls: ffmpeg remux zaman aşımı")
            return None
        except asyncio.CancelledError:
            try:
                process.kill()
            except Exception:
                pass
            await process.wait()
            raise

        if (
            process.returncode == 0
            and merged.exists()
            and merged.stat().st_size > 0
        ):
            return merged

        detail = stderr.decode("utf-8", errors="ignore").strip()
        logger.info(
            "hls: ffmpeg remux başarısız (%s), ham birleştirmeye dönülüyor",
            detail[-300:] or f"çıkış kodu {process.returncode}",
        )
        return None
    except Exception as exc:
        logger.info("hls: ffmpeg remux hatası: %s", exc)
        return None
    finally:
        try:
            playlist_path.unlink()
        except OSError:
            pass
        if process is None or process.returncode != 0:
            try:
                merged.unlink()
            except OSError:
                pass


async def download_hls_segments(
    client: Any,
    playlist: Optional[MediaPlaylist],
    indices: list[int],
    headers: Optional[dict[str, str]] = None,
    *,
    temp_root: Path = WAVEFORM_TEMP_DIR,
    concurrency: int = SEGMENT_CONCURRENCY,
    timeout: float = DOWNLOAD_TIMEOUT_SECONDS,
) -> Optional[DownloadedSegments]:
    """Yalnızca istenen HLS segmentlerini paralel indirir.

    Storyboard kareleri seyrek olduğu için tüm playlist'i indirmek yerine
    her karenin bulunduğu segment alınır. fMP4 playlist'lerde init bölümü
    her segmentin başına eklenir; böylece her parça tek başına çözülebilir.
    Uygun olmayan playlist veya indirme hatasında None döner.
    """
    if (
        client is None
        or playlist is None
        or not playlist.endlist
        or playlist.encrypted
        or playlist.byterange
        or not playlist.segments
    ):
        return None

    selected = sorted(
        {
            int(index)
            for index in indices
            if 0 <= int(index) < len(playlist.segments)
        }
    )
    if not selected:
        return None

    temp_root.mkdir(parents=True, exist_ok=True)
    temp_dir = Path(tempfile.mkdtemp(prefix="sb-", dir=temp_root))
    started = time.perf_counter()

    try:
        init_path: Optional[Path] = None
        if playlist.init_url:
            init_path = temp_dir / "init.bin"
            await _fetch_to_file(client, playlist.init_url, init_path, headers)

        semaphore = asyncio.Semaphore(max(1, concurrency))

        async def fetch(index: int) -> tuple[int, Path]:
            destination = temp_dir / f"segment-{index:06d}.bin"
            async with semaphore:
                await _fetch_to_file(
                    client,
                    playlist.segments[index].url,
                    destination,
                    headers,
                )
            if init_path is None:
                return index, destination

            merged = temp_dir / f"segment-{index:06d}.mp4"
            _merge_parts([init_path, destination], merged)
            try:
                destination.unlink()
            except OSError:
                pass
            return index, merged

        tasks = [asyncio.create_task(fetch(index)) for index in selected]
        try:
            results = list(
                await asyncio.wait_for(
                    asyncio.gather(*tasks),
                    timeout=timeout,
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
            logger.warning(
                "hls: storyboard segmentleri indirilemedi (%.1f sn): %s",
                time.perf_counter() - started,
                exc,
            )
            shutil.rmtree(temp_dir, ignore_errors=True)
            return None

        starts: dict[int, float] = {}
        durations: dict[int, float] = {}
        cursor = 0.0
        for index, segment in enumerate(playlist.segments):
            starts[index] = cursor
            durations[index] = max(0.0, segment.duration)
            cursor += durations[index]

        logger.info(
            "hls: storyboard %d segment %.1f sn'de indirildi",
            len(selected),
            time.perf_counter() - started,
        )
        return DownloadedSegments(
            temp_dir=temp_dir,
            paths=dict(results),
            starts=starts,
            durations=durations,
        )
    except asyncio.CancelledError:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(temp_dir, ignore_errors=True)
        logger.warning("hls: storyboard segment hatası: %s", exc)
        return None


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
    if playlist.discontinuity:
        logger.info(
            "hls: discontinuity içeren playlist, doğrudan FFmpeg kullanılacak"
        )
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
    playlist: Optional[MediaPlaylist] = None,
    concurrency: int = SEGMENT_CONCURRENCY,
    temp_root: Path = WAVEFORM_TEMP_DIR,
) -> Optional[DownloadedMedia]:
    """HLS medya playlist'inden yalnızca klip aralığını indirir.

    Dışa aktarmada FFmpeg'in AV1/fMP4 HLS seek sorununu aşmak için kullanılır:
    FFmpeg uzak playlist yerine, istenen aralığı içeren yerel bir dosyayı okur.
    Canlı/DVR playlist'lerinde de çalışır; çağıran taraf `start`/`end` değerlerini
    o anki pencereye göre vermelidir.

    `playlist` verilirse playlist yeniden indirilmez. Zaman hizalaması yapan
    çağıran (bkz. `exporter.align_live_timeline`) kaymanın hesaplandığı
    anlık görüntüyü buradan geçirir; aksi halde pencere iki okuma arasında
    kayabilir ve klip bir segment kaymış olur.

    Uygun olmayan playlist'te `None` döner ve çağıran eski yola devam eder.
    """
    if client is None:
        return None
    if playlist is None and _probably_media_file(playlist_url):
        return None

    if playlist is None:
        # İmzalı/uzantısız doğrudan medya URL'lerinde (ör. 4 saatlik MP4) playlist
        # aramak için 1 MB okumak, yavaş CDN'lerde işi dakikalarca %0'da tutabilir.
        # Önce ucuz bir HLS tespiti yap; HLS değilse doğrudan FFmpeg'e bırak.
        try:
            is_hls = await asyncio.wait_for(
                detect_hls(client, playlist_url, headers),
                timeout=HLS_DETECT_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            logger.info("hls: tespit zaman aşımı, doğrudan FFmpeg kullanılacak")
            return None
        if not is_hls:
            logger.info("hls: kaynak HLS değil, doğrudan FFmpeg kullanılacak")
            return None

        playlist = await load_export_playlist(client, playlist_url, headers)
    if playlist is None:
        return None
    if playlist.discontinuity:
        logger.info(
            "hls: discontinuity içeren aralık, doğrudan FFmpeg kullanılacak"
        )
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

        remuxed = await _remux_parts_with_ffmpeg(
            temp_dir, init_path, parts, segments
        )
        if remuxed is not None:
            merged = remuxed
        else:
            _merge_parts(
                ([init_path] if init_path is not None else []) + parts, merged
            )
        for part in parts:
            try:
                part.unlink()
            except OSError:
                pass
        if init_path is not None:
            try:
                init_path.unlink()
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
        or playlist.discontinuity
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
