"""FFmpeg dışa aktarma işçisi: komutu kurar, çalıştırır ve ilerlemeyi raporlar."""
import asyncio
import logging
import re
import tempfile
import time
from pathlib import Path
from typing import Any, Optional

from config import EXPORTS_DIR, OUTPUT_FORMATS, USER_AGENT
from core.i18n import set_language, t
from core.jobs import CANCELLED, DONE, ERROR, RUNNING
from core.timecode import parse_time_to_seconds, seconds_to_hms
from services.gpu import (
    detect_gpu_capability,
    get_gpu_encoder,
    gpu_encoder_arguments,
)
from services.header_store import get_headers
from services.local_media import local_path
from services.prober import probe_url
from services.request_headers import ffmpeg_input_args, sanitize_headers
from services.segment_downloader import (
    DownloadedMedia,
    LiveTimelineError,
    download_hls_range,
    live_timeline_shift,
)
from services.thumbnails import generate_thumbnail

logger = logging.getLogger(__name__)

MIN_CLIP_DURATION = 0.1

#: FFmpeg bu süre boyunca anlamlı ilerleme kaydetmezse akış takılmış sayılır.
STALL_STARTUP_GRACE_SECONDS = 30.0
STALL_WINDOW_SECONDS = 20.0
STALL_MIN_PROGRESS_SECONDS = 0.5
#: Takılan işi kaldığı yerden sürdürme denemeleri.
MAX_RESUME_ATTEMPTS = 8
MAX_NO_PROGRESS_ATTEMPTS = 3
MIN_RESUME_STEP_SECONDS = 0.5

#: Çoklu kesim: tek istekte işlenebilecek en fazla parça ve en kısa parça.
MAX_EXPORT_SEGMENTS = 200
MIN_SEGMENT_DURATION = 0.01

#: Yeniden kodlanan MP4 çıktıları için kalite profilleri.
#: Dengeli profil, HD çözünürlüğü korurken x264'ün daha verimli preset'i ve
#: biraz daha yüksek CRF değeriyle tipik olarak %20-30 daha küçük dosya üretir.
DEFAULT_EXPORT_QUALITY = "balanced"
DEFAULT_EXPORT_CODEC = "h264"
EXPORT_CODECS = {"h264", "hevc"}
EXPORT_QUALITY_PROFILES: dict[str, dict[str, Any]] = {
    "high": {
        "preset": "veryfast",
        "crf": 20,
        "crop_crf": 21,
        "audio_bitrate": "192k",
        "hevc_preset": "fast",
        "hevc_crf": 22,
        "hevc_crop_crf": 23,
    },
    "balanced": {
        "preset": "medium",
        "crf": 22,
        "crop_crf": 23,
        "audio_bitrate": "160k",
        "hevc_preset": "medium",
        "hevc_crf": 24,
        "hevc_crop_crf": 25,
    },
    "compact": {
        "preset": "medium",
        "crf": 25,
        "crop_crf": 26,
        "audio_bitrate": "128k",
        "hevc_preset": "medium",
        "hevc_crf": 27,
        "hevc_crop_crf": 28,
    },
}


class ExportError(Exception):
    """Geçersiz dışa aktarma isteği."""


#: Aynı saniyede başlatılan paralel işlerin aynı dosya adını seçmesini engeller:
#: yol üretilirken rezerve edilir, tek olay döngüsünde çalıştığı için kilit gerekmez.
_RESERVED_PATHS: set[str] = set()


# --------------------------------------------------------------- yardımcılar
def build_output_path(requested_name: str, output_format: str) -> Path:
    """Güvenli, benzersiz bir çıktı yolu üretir ve yolu rezerve eder."""
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    base = re.sub(r"[^a-zA-Z0-9_\-]+", "_", requested_name or "").strip("_")
    if not base:
        base = f"clip_{timestamp}"
    extension = output_format if output_format in OUTPUT_FORMATS else "mp4"

    candidate = EXPORTS_DIR / f"{base}.{extension}"
    counter = 1
    while candidate.exists() or str(candidate) in _RESERVED_PATHS:
        candidate = EXPORTS_DIR / f"{base}_{counter}.{extension}"
        counter += 1
    _RESERVED_PATHS.add(str(candidate))
    return candidate


def _normalized_crop(crop: Any) -> Optional[dict[str, int]]:
    """Crop parametrelerini doğrular, video sınırlarına kırpar ve çift sayıya indirger."""
    if not isinstance(crop, dict) or not crop.get("enabled"):
        return None

    try:
        x = max(0, int(crop.get("x", 0)))
        y = max(0, int(crop.get("y", 0)))
        width = int(crop.get("width", 0))
        height = int(crop.get("height", 0))
    except (TypeError, ValueError):
        return None

    source_width = int(crop.get("source_width") or 0)
    source_height = int(crop.get("source_height") or 0)

    if source_width:
        x = min(x, max(0, source_width - 2))
        width = min(width, source_width - x)
    if source_height:
        y = min(y, max(0, source_height - 2))
        height = min(height, source_height - y)

    # x264/x265 çift boyut ister
    width -= width % 2
    height -= height % 2

    if width < 2 or height < 2:
        return None

    return {"x": x, "y": y, "width": width, "height": height}


def _seek_offset(payload: dict[str, Any], key: str, default: float) -> float:
    """Yerelleştirilmiş girişte kullanılacak göreli seek değerini okur."""
    value = payload.get(key)
    if value is None:
        return default
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError):
        return default


def _quality_profile(payload: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """İstenen kalite profilini döndürür; bilinmeyen değer varsayılana düşer."""
    requested = str(payload.get("quality", DEFAULT_EXPORT_QUALITY)).strip().lower()
    if requested not in EXPORT_QUALITY_PROFILES:
        requested = DEFAULT_EXPORT_QUALITY
    return requested, EXPORT_QUALITY_PROFILES[requested]


def _export_codec(payload: dict[str, Any]) -> str:
    """İstenen video kodlayıcısını döndürür; bilinmeyen değer H.264'e düşer."""
    requested = str(payload.get("codec", DEFAULT_EXPORT_CODEC)).strip().lower()
    if requested in {"h265", "h.265"}:
        requested = "hevc"
    return requested if requested in EXPORT_CODECS else DEFAULT_EXPORT_CODEC


def _output_fps(payload: dict[str, Any]) -> Optional[int]:
    """İsteğe bağlı çıktı kare hızını doğrular; geçersiz değer yok sayılır."""
    raw = payload.get("output_fps")
    if raw in (None, "", 0, "0"):
        return None
    try:
        fps = int(float(raw))
    except (TypeError, ValueError):
        return None
    return fps if 1 <= fps <= 120 else None


def is_gpu_render_eligible(
    output_format: str,
    mode: str,
    crop: Optional[dict[str, int]],
    codec: str = DEFAULT_EXPORT_CODEC,
    output_fps: Optional[int] = None,
) -> bool:
    """GPU yalnızca yeniden kodlanan H.264 MP4 çıktılarında kullanılabilir."""
    if output_format != "mp4" or codec == "hevc":
        return False
    return crop is not None or mode != "fast" or output_fps is not None


#: Yerel kaynakta yeniden kodlamadan kopyalanabilecek kodekler. MP4 kabına
#: olduğu gibi konabildikleri ve tarayıcıda çalındıkları için yalnızca bunlar
#: kabul edilir; HEVC/VP9/AV1 kopyalanırsa etiket/kap uyumsuzluğu çıkabilir.
COPY_VIDEO_CODECS = {"h264"}
COPY_AUDIO_CODECS = {"aac", "mp3"}

#: Kopyalama kararı için yerel dosya ffprobe sonucu önbelleği: yol →
#: ((mtime_ns, boyut), bilgi). Aynı dosya tekrar dışa aktarılırken ffprobe
#: yeniden çalışmaz; dosya değişirse imza tutmadığı için tazelenir.
_COPY_PROBE_CACHE: dict[str, tuple[tuple[int, int], dict[str, Any]]] = {}
_COPY_PROBE_LIMIT = 64


async def _local_copy_probe(path: Path) -> Optional[dict[str, Any]]:
    """Yerel dosyanın kodek bilgisini okur; okunamazsa None döner."""
    try:
        stat = path.stat()
    except OSError:
        return None

    signature = (stat.st_mtime_ns, stat.st_size)
    cached = _COPY_PROBE_CACHE.get(str(path))
    if cached is not None and cached[0] == signature:
        return cached[1]

    try:
        info = await probe_url(str(path))
    except Exception as exc:  # en iyi çaba: kopyalanamıyorsa yeniden kodlanır
        logger.warning("export: yerel kopya denetimi başarısız: %s", exc)
        return None

    if len(_COPY_PROBE_CACHE) >= _COPY_PROBE_LIMIT:
        _COPY_PROBE_CACHE.clear()
    _COPY_PROBE_CACHE[str(path)] = (signature, info)
    return info


def _audio_codec_name(info: dict[str, Any]) -> Optional[str]:
    """ffprobe sonucundan ses kodeğini çıkarır (ses yoksa None)."""
    for stream in (info.get("raw") or {}).get("streams", []) or []:
        if stream.get("codec_type") == "audio":
            return str(stream.get("codec_name") or "unknown")
    return None


async def local_copy_eligible(
    payload: dict[str, Any], segments: list[tuple[float, float]]
) -> bool:
    """Yerel kaynakta klip yeniden kodlanmadan kopyalanabilir mi?

    Yerel dosya diskten doğrudan okunduğu için akış kopyalama neredeyse
    anlıktır; yeniden kodlama ise dakikalar sürebilir. Kırpma (crop), kare
    hızı değişimi, H.265 çıktısı veya silme sonrası birden çok parça
    istendiğinde filtre/kodlayıcı gerektiği için kopyalama yapılmaz.

    Kaynak kodeği ffprobe ile doğrulanır: HEVC/VP9/AV1 gibi akışlar MP4
    kabına olduğu gibi konduğunda etiket/kap uyumsuzluğu çıkabildiğinden
    yalnızca H.264 (ve AAC/MP3 ses) kopyalanır.
    """
    if len(segments) != 1:
        return False
    if str(payload.get("output_format", "mp4")).lower() != "mp4":
        return False
    if _normalized_crop(payload.get("crop")) is not None:
        return False
    if _export_codec(payload) != DEFAULT_EXPORT_CODEC:
        return False
    if _output_fps(payload) is not None:
        return False
    # Ayrı ses akışı (YouTube gibi sessiz video) birleştirme ister: kopyalanamaz.
    if str(payload.get("audio_url") or "").strip():
        return False

    url = str(payload.get("url", "")).strip()
    if not url:
        return False
    path = local_path(url)
    if path is None:
        return False

    info = await _local_copy_probe(path)
    if not info:
        return False
    if str(info.get("codec") or "") not in COPY_VIDEO_CODECS:
        return False

    audio_codec = _audio_codec_name(info)
    return audio_codec is None or audio_codec in COPY_AUDIO_CODECS


def build_ffmpeg_command(
    payload: dict[str, Any],
    output_path: Path,
    *,
    gpu_encoder: Optional[str] = None,
    intermediate: bool = False,
) -> list[str]:
    """Payload'dan ffmpeg komutunu üretir (saf fonksiyon, test edilebilir).

    `gpu_encoder` yalnızca çağıran taraf yeteneği doğruladıktan sonra verilir;
    hızlı kopyalama, GIF ve MP3 çıktılarında yok sayılır.

    `intermediate=True` ise çıktı, kesilebilir/birleştirilebilir MPEG-TS olarak
    yazılır. Yeniden denemeli dışa aktarmada parçalar bu biçimde üretilir;
    son MP4 birleştirme adımında oluşturulur.
    """
    url = str(payload.get("url", "")).strip()
    if not url:
        raise ExportError(t("error.sourceEmpty"))

    # Yerel dosya (/uploads/...) ise ffmpeg dosyayı doğrudan okur: ağ turu olmaz.
    url = str(local_path(url) or url)

    # Video akışı sessizse (YouTube HLS) ses ayrı bir akıştan gelir.
    audio_url = str(payload.get("audio_url") or "").strip()
    if (
        audio_url
        and ".m3u8" not in audio_url.lower()
        and "://" not in audio_url
        and not Path(audio_url).is_file()
    ):
        audio_url = ""
    if audio_url:
        audio_url = str(local_path(audio_url) or audio_url)

    start = parse_time_to_seconds(payload.get("start_time", 0))
    end = parse_time_to_seconds(payload.get("end_time", 0))
    if end <= start:
        raise ExportError(t("error.endAfterStart"))

    video_seek = _seek_offset(payload, "_video_seek", start)
    audio_seek = _seek_offset(payload, "_audio_seek", start)
    clip_duration = end - start
    output_format = str(payload.get("output_format", "mp4")).lower()
    mode = str(payload.get("mode", "exact")).lower()
    quality_name, quality = _quality_profile(payload)
    codec = _export_codec(payload)
    output_fps = _output_fps(payload)
    crop = _normalized_crop(payload.get("crop"))
    requires_reencode = (
        crop is not None or mode != "fast" or codec == "hevc" or output_fps is not None
    )
    use_gpu = (
        is_gpu_render_eligible(output_format, mode, crop, codec, output_fps)
        and bool(gpu_encoder)
    )
    if use_gpu and get_gpu_encoder(gpu_encoder or "") is None:
        raise ExportError(t("error.gpuEncoderInvalid", encoder=gpu_encoder))

    # MP3'te ses tek başına yeterli: kaynak sessizse doğrudan ses akışı kullanılır.
    if output_format == "mp3" and audio_url:
        url = audio_url
        video_seek = audio_seek

    # Ses birleştirme yalnızca MP4 çıktısında ve ses akışı ayrı verildiğinde yapılır.
    merge_audio = bool(audio_url) and output_format == "mp4" and url != audio_url

    command = ["ffmpeg", "-y", "-nostdin", "-nostats", "-progress", "pipe:1"]
    # curl ile yapıştırılan başlıklar ve header_token'dan (TikTok Referer gibi CDN
    # başlıkları) birleştirilen başlıklar iki girişe de uygulanır.
    token_headers = get_headers(payload.get("header_token"))
    user_headers = sanitize_headers(payload.get("headers"))
    merged_headers = {**token_headers, **user_headers} or None
    input_args = ffmpeg_input_args(merged_headers, USER_AGENT)
    if url.startswith(("http://", "https://")):
        command += input_args

    command += ["-ss", seconds_to_hms(video_seek), "-i", url]

    if merge_audio:
        if audio_url.startswith(("http://", "https://")):
            command += input_args
        command += ["-ss", seconds_to_hms(audio_seek), "-i", audio_url]

    command += ["-t", seconds_to_hms(clip_duration)]

    # Akış eşlemesi açıkça belirtilir: analiz (ffprobe v:0) ile dışa aktarmanın
    # aynı akışı kullanmasını garantiler. Çoklu varyantlı HLS master
    # playlist'lerinde ffmpeg aksi halde en yüksek çözünürlüklü varyantı seçer
    # ve kırpma koordinatları kayar.
    if output_format == "mp3":
        command += ["-map", "0:a:0"] if url == audio_url else ["-map", "0:a:0?"]
    else:
        command += ["-map", "0:v:0"]
        if output_format == "mp4":
            command += ["-map", "1:a:0"] if merge_audio else ["-map", "0:a:0?"]

    if output_format == "gif":
        filters = ["setpts=PTS-STARTPTS"]
        if crop:
            filters.append(f"crop={crop['width']}:{crop['height']}:{crop['x']}:{crop['y']}")
        filters.append("fps=15,scale=480:-1:flags=lanczos")
        graph = ",".join(filters) + ",split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"
        command += ["-vf", graph]

    elif output_format == "mp3":
        command += ["-af", "asetpts=PTS-STARTPTS", "-vn", "-c:a", "libmp3lame", "-q:a", "2"]

    elif requires_reencode:
        # Hassas kesim (gerekirse crop ile birlikte) — kare hassasiyetinde yeniden kodlama.
        # PTS sıfırlama, HLS/uzun akışlarda seek sonrası ilk saniyelerin donmuş
        # görünmesini önler.
        filters = ["setpts=PTS-STARTPTS"]
        if crop:
            filters.append(f"crop={crop['width']}:{crop['height']}:{crop['x']}:{crop['y']}")
        if output_fps:
            filters.append(f"fps={output_fps}")
        command += ["-vf", ",".join(filters)]
        command += ["-af", "asetpts=PTS-STARTPTS"]
        if use_gpu:
            command += gpu_encoder_arguments(gpu_encoder or "", quality_name)
        elif codec == "hevc":
            command += [
                "-c:v", "libx265",
                "-preset", str(quality["hevc_preset"]),
                "-crf", str(quality["hevc_crop_crf"] if crop else quality["hevc_crf"]),
                "-x265-params", "log-level=error",
            ]
            if not intermediate:
                command += ["-tag:v", "hvc1"]
        else:
            command += [
                "-c:v", "libx264",
                "-preset", quality["preset"],
                "-crf", str(quality["crop_crf"] if crop else quality["crf"]),
            ]
        command += [
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", quality["audio_bitrate"],
        ]
        if not intermediate:
            command += ["-movflags", "+faststart"]

    else:
        # Hızlı kesim — yeniden kodlama yok, anahtar kareye hizalı
        command += ["-c", "copy", "-avoid_negative_ts", "make_zero"]
        if ".m3u8" in url.lower() and not merge_audio:
            command += ["-bsf:a", "aac_adtstoasc"]

    if intermediate:
        # Ara TS parçaları concat demuxer'a girerken negatif/DTS kaynaklı
        # sıçramaları önle; son birleştirme de ayrıca normalize edilir.
        command += ["-avoid_negative_ts", "make_zero", "-f", "mpegts"]
    command.append(str(output_path))
    return command


# ------------------------------------------------------------------ işçi
async def select_gpu_encoder(
    payload: dict[str, Any],
) -> tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
    """İstenen GPU kodlayıcıyı doğrular.

    Dönüş: `(kodlayıcı, CPU'ya dönüş nedeni, ayrıntı, kodlayıcı etiketi)`.
    GPU istenmemişse tüm alanlar `None` döner.
    """
    if str(payload.get("encoder", "cpu")).strip().lower() != "gpu":
        return None, None, None, None

    output_format = str(payload.get("output_format", "mp4")).lower()
    mode = str(payload.get("mode", "exact")).lower()
    codec = _export_codec(payload)
    output_fps = _output_fps(payload)
    crop = _normalized_crop(payload.get("crop"))
    if codec == "hevc":
        return None, t("gpu.fallback.hevcCpu"), None, None
    if not is_gpu_render_eligible(output_format, mode, crop, codec, output_fps):
        return None, t("gpu.fallback.ineligible"), None, None

    capability = await detect_gpu_capability()
    if capability.encoder is None:
        reason = t(capability.reason_key or "gpu.reason.probeFailed")
        return (
            None,
            t("gpu.fallback.unavailable", reason=reason),
            capability.detail,
            None,
        )

    return capability.encoder.name, None, None, capability.encoder.label


def _remove_partial_output(output_path: Path) -> None:
    """Başarısız denemeden kalan yarım dosyayı temizler."""
    try:
        output_path.unlink(missing_ok=True)
    except OSError:
        pass


def _mark_done(job: dict[str, Any], output_path: Path) -> None:
    job["status"] = DONE
    job["progress"] = 100.0
    job["size_mb"] = round(output_path.stat().st_size / (1024 * 1024), 2)
    job["elapsed_sec"] = round(time.time() - job["started_at"], 1)


async def _warm_thumbnail(output_path: Path) -> None:
    """Kartlar ilk açılışta beklemesin diye export sonrası thumbnail üretir."""
    try:
        await asyncio.to_thread(generate_thumbnail, output_path)
    except Exception as exc:  # en iyi çaba: export başarısını etkilemez
        logger.warning("export: thumbnail üretilemedi: %s", exc)


async def stage_hls_sources(
    payload: dict[str, Any],
    client: Any,
    start: float,
    end: float,
    *,
    playlist: Any = None,
) -> tuple[dict[str, Any], list[DownloadedMedia]]:
    """Dışa aktarma için HLS girişlerini istenen aralıkla yerelleştirir.

    AV1/fMP4 HLS'te FFmpeg'in uzak playlist üzerinde seek etmesi güvenilir
    değil; yalnızca klip aralığını indirip yerel dosyadan kesmek hem doğru hem
    çok daha hızlı. Uygun olmayan kaynaklarda payload değişmeden döner.

    `playlist`, canlı/DVR kaynağında zaman kaymasının hesaplandığı anlık
    görüntüdür. İndirme aynı görüntüyü kullanır; aksi halde iki okuma arasında
    pencere kayar ve klip bir segment kaymış olur.
    """
    staged = dict(payload)
    downloads: list[DownloadedMedia] = []
    if client is None:
        return staged, downloads

    token_headers = get_headers(payload.get("header_token"))
    user_headers = sanitize_headers(payload.get("headers"))
    headers = {**token_headers, **user_headers} or {}
    video_url = str(payload.get("url", "")).strip()
    audio_url = str(payload.get("audio_url") or "").strip()
    output_format = str(payload.get("output_format", "mp4")).lower()
    primary_is_audio = output_format == "mp3" and bool(audio_url)
    primary_url = audio_url if primary_is_audio else video_url
    # Yerel dosyalar zaten doğrudan diskten okunacak; HLS hazırlığı için
    # HTTP üzerinden tekrar indirilmeleri büyük dosyalarda bellek/CPU israfıdır.
    primary_is_local = local_path(primary_url) is not None
    audio_is_local = bool(audio_url) and local_path(audio_url) is not None

    if primary_url.startswith(("http://", "https://")) and not primary_is_local:
        media = await download_hls_range(
            client,
            primary_url,
            start,
            end,
            headers,
            playlist=None if primary_is_audio else playlist,
        )
        if media is not None:
            seek = max(0.0, start - media.start)
            staged["url"] = str(media.path)
            staged["_video_seek"] = seek
            downloads.append(media)
            if primary_is_audio:
                staged["audio_url"] = str(media.path)
                staged["_audio_seek"] = seek

    if (
        output_format == "mp4"
        and audio_url
        and audio_url != video_url
        and audio_url.startswith(("http://", "https://"))
        and not audio_is_local
    ):
        audio_media = await download_hls_range(
            client, audio_url, start, end, headers
        )
        if audio_media is not None:
            staged["audio_url"] = str(audio_media.path)
            staged["_audio_seek"] = max(0.0, start - audio_media.start)
            downloads.append(audio_media)

    if downloads:
        logger.info(
            "export: %d HLS girişi yerelleştirildi (%.1f-%.1f sn)",
            len(downloads),
            start,
            end,
        )
    return staged, downloads


async def _read_stderr(process, limit: int = 64 * 1024) -> str:
    """FFmpeg çalışırken stderr'i tüketir; yalnızca son ``limit`` baytı saklar.

    stderr boru hattı dolduğunda FFmpeg yazmayı bekler. Bu nedenle stderr,
    süreç bitene kadar değil, süreç çalışırken okunmalıdır. Uzun süren veya
    çok uyarı üreten işlerde aksi halde dışa aktarma %0'da kilitlenir.
    """
    assert process.stderr is not None
    tail = b""
    while True:
        chunk = await process.stderr.read(64 * 1024)
        if not chunk:
            break
        tail = (tail + chunk)[-limit:]
    return tail.decode("utf-8", errors="ignore").strip()


async def _watch_stall(
    process,
    job: dict[str, Any],
    total_duration: float,
    progress_base: float,
    result: dict[str, Any],
) -> None:
    """FFmpeg ilerlemesini izler; akış sürünüyorsa süreci sonlandırır.

    Tek başına ``speed`` alanına güvenmek yanıltıcı olabilir: FFmpeg seek
    sırasında hızı ``0.003x`` gösterse bile birkaç saniye sonra toparlayabilir.
    Bu yüzden ``out_time`` ilerlemesi belirli bir pencerede ölçülür. Pencere
    içinde yeterli ilerleme yoksa bağlantı takılmış kabul edilir.
    """
    started = time.monotonic()
    window_started = started
    window_start_sec = float(job.get("current_sec") or progress_base)
    # Çok kısa kliplerde 0.5 sn eşiği imkânsız olabilir; süreye göre küçült.
    progress_needed = min(
        STALL_MIN_PROGRESS_SECONDS, max(0.05, total_duration * 0.02)
    )

    while process.returncode is None:
        await asyncio.sleep(2.0)
        if process.returncode is not None:
            return

        now = time.monotonic()
        current = float(job.get("current_sec") or progress_base)

        # FFmpeg'in ilk bağlantı/seek süresine tolerans tanı.
        if now - started < STALL_STARTUP_GRACE_SECONDS:
            window_started = now
            window_start_sec = current
            continue

        if current - window_start_sec >= progress_needed:
            window_started = now
            window_start_sec = current
            continue

        if now - window_started >= STALL_WINDOW_SECONDS:
            result["stalled"] = True
            result["stalled_at"] = round(current - progress_base, 2)
            logger.warning(
                "export: ffmpeg akışı takıldı (%.1f sn'de %.2f sn ilerleme); "
                "kaldığı yerden yeniden denenecek",
                current,
                current - window_start_sec,
            )
            try:
                process.kill()
            except Exception:
                pass
            return


async def _run_ffmpeg(
    command: list[str],
    job: dict[str, Any],
    total_duration: float,
    progress_base: float = 0.0,
) -> tuple[int, str, bool]:
    """FFmpeg'i çalıştırır; ilerlemeyi günceller ve takılmayı bildirir.

    Dönüş: ``(returncode, stderr_kuyruğu, takıldı_mı)``.
    """
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    job["process"] = process
    stall_result: dict[str, Any] = {"stalled": False}

    try:
        _, _, stderr_tail, _ = await asyncio.gather(
            _read_progress(process, job, total_duration, progress_base),
            process.wait(),
            _read_stderr(process),
            _watch_stall(process, job, total_duration, progress_base, stall_result),
        )
    finally:
        if job.get("process") is process:
            job.pop("process", None)

    returncode = process.returncode if process.returncode is not None else -1
    return returncode, stderr_tail, bool(stall_result["stalled"])


def _can_resume(payload: dict[str, Any]) -> bool:
    """Bu iş parçalı/kaldığı yerden devam eden dışa aktarmaya uygun mu?

    Yalnızca MP4 ve yeniden kodlama yapan işler desteklenir. MPEG-TS ara
    parçaları H.264/H.265 ve AAC taşıyabildiğinden, doğrudan kopyalama (fast)
    ve GIF/MP3 çıktıları bu yoldan geçirilmez.
    """
    output_format = str(payload.get("output_format", "mp4")).lower()
    if output_format != "mp4":
        return False
    mode = str(payload.get("mode", "exact")).lower()
    return (
        _normalized_crop(payload.get("crop")) is not None
        or mode != "fast"
        or _export_codec(payload) == "hevc"
        or _output_fps(payload) is not None
    )


def _resume_payload(
    payload: dict[str, Any], part_start: float, offset: float
) -> dict[str, Any]:
    """Kalan parça için payload kopyası üretir.

    Yerelleştirilmiş HLS girişlerinde ``_video_seek``/``_audio_seek`` zaten
    dosya başlangıcına göreydi; parça başlangıcı kadar eklenir. Doğrudan uzak
    girişlerde ise ``build_ffmpeg_command`` yeni mutlak başlangıcı kullanır.
    """
    part = dict(payload)
    part["start_time"] = part_start
    for key in ("_video_seek", "_audio_seek"):
        value = payload.get(key)
        if value is None:
            continue
        try:
            part[key] = max(0.0, float(value) + offset)
        except (TypeError, ValueError):
            pass
    return part


def _next_resume_offset(
    offset: float, reached: float, total_duration: float
) -> float:
    """Bir sonraki parçanın başlangıcını, içerik örtüşmesi olmadan döndürür.

    Eski davranış son 0.25 saniyeyi tekrar encode ediyordu. Concat demuxer bu
    tekrarı ayrı bir zaman aralığı gibi eklediği için seam noktalarında aynı
    kareler iki kez gösteriliyor ve mikro takılma oluşuyordu. Yeniden kodlama
    zaten istenen ana kadar seek ettiğinden örtüşmeye gerek yoktur.
    """
    return min(total_duration, offset + max(0.0, reached))


async def _probe_video_duration(path: Path) -> Optional[float]:
    """Ara TS parçasının video akış süresini okur; okunamazsa None döner.

    MPEG-TS format süresi, AAC priming paketi nedeniyle video süresinden
    yaklaşık bir ses çerçevesi kadar uzun olabilir. Concat demuxer'a bu format
    süresi verilirse parçalar arasında boşluk oluşur; video akış süresi ise
    gerçek kare sınırını verir.
    """
    try:
        process = await asyncio.create_subprocess_exec(
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            stdout, _ = await asyncio.wait_for(
                process.communicate(), timeout=10.0
            )
        except asyncio.TimeoutError:
            try:
                process.kill()
            except Exception:
                pass
            await process.wait()
            return None
        except asyncio.CancelledError:
            try:
                process.kill()
            except Exception:
                pass
            await process.wait()
            raise
    except Exception:
        return None

    for line in stdout.decode("utf-8", errors="ignore").splitlines():
        try:
            duration = float(line.strip())
        except ValueError:
            continue
        if duration > 0:
            return duration
    return None


def _build_concat_manifest(parts: list[tuple[Path, float]]) -> str:
    """Concat demuxer için dosya ve video süresi direktiflerini üretir."""
    lines: list[str] = []
    for part, part_duration in parts:
        part_text = part.as_posix().replace("'", "'\\''")
        lines.append(f"file '{part_text}'")
        # Format süresi yerine video süresini kullan: AAC priming farkı
        # concat demuxer tarafından parça aralığı sanılıp boşluk yaratıyor.
        lines.append(f"duration {max(0.001, part_duration):.6f}")
    return "\n".join(lines) + "\n"


def _build_concat_remux_command(
    concat_path: Path,
    output_path: Path,
    total_duration: float,
    codec: str,
) -> list[str]:
    """Ara TS parçalarını tek MP4'te birleştiren komutu üretir.

    ``+genpts`` ve ``make_zero``, parça sınırlarında oluşabilecek eksik/negatif
    zaman damgalarını normalize eder; aksi halde oynatıcılar PTS sıçraması
    bildirip kare atlayabilir.
    """
    command = [
        "ffmpeg",
        "-y",
        "-nostdin",
        "-nostats",
        "-fflags",
        "+genpts",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat_path),
        "-c",
        "copy",
        "-avoid_negative_ts",
        "make_zero",
    ]
    if codec == "hevc":
        command += ["-tag:v", "hvc1"]
    command += [
        "-t",
        seconds_to_hms(total_duration),
        "-movflags",
        "+faststart",
        str(output_path),
    ]
    return command


async def _run_ffmpeg_remux(command: list[str], job: dict[str, Any]) -> tuple[int, str]:
    """İlerleme üretmeyen birleştirme FFmpeg'ini çalıştırır."""
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    job["process"] = process
    stderr_task = asyncio.create_task(_read_stderr(process))
    try:
        await process.wait()
        stderr_tail = await stderr_task
    finally:
        if job.get("process") is process:
            job.pop("process", None)
    returncode = process.returncode if process.returncode is not None else -1
    return returncode, stderr_tail


async def _run_resumable_export(
    payload: dict[str, Any],
    output_path: Path,
    job: dict[str, Any],
    gpu_encoder: Optional[str] = None,
) -> tuple[int, str]:
    """MP4 çıktısını parçalar halinde üretir; takılınca kaldığı yerden sürer.

    Her parça ayrı bir MPEG-TS dosyasına yazılır. FFmpeg akışı takılırsa son
    doğrulanan ``out_time`` noktasından yeni bir parça başlatılır. Tamamlanan
    parçalar sonunda tek bir MP4'e dönüştürülür. Böylece kaynak CDN kısa süreli
    durakladığında tüm klip baştan indirilmez.
    """
    start = parse_time_to_seconds(payload.get("start_time", 0))
    end = parse_time_to_seconds(payload.get("end_time", 0))
    total_duration = max(MIN_CLIP_DURATION, end - start)
    offset = 0.0
    attempts = 0
    no_progress_attempts = 0
    #: (parça yolu, concat demuxer için video süresi)
    parts: list[tuple[Path, float]] = []
    last_returncode = -1
    last_stderr = ""

    with tempfile.TemporaryDirectory(prefix="clip-export-") as temp_root:
        temp_dir = Path(temp_root)

        while offset < total_duration - 0.05:
            if job["status"] == CANCELLED:
                return -1, ""

            attempts += 1
            part_start = start + offset
            part_path = temp_dir / f"part_{attempts:03d}.ts"
            part_duration = max(0.01, end - part_start)
            part_payload = _resume_payload(payload, part_start, offset)
            command = build_ffmpeg_command(
                part_payload,
                part_path,
                gpu_encoder=gpu_encoder,
                intermediate=True,
            )
            job["command"] = " ".join(command)
            job["retry_count"] = max(0, attempts - 1)
            job["resume_from"] = round(offset, 2)
            job["current_sec"] = round(offset, 2)
            if attempts > 1:
                job["stage"] = "resuming"
            else:
                job.pop("stage", None)

            returncode, stderr_tail, stalled = await _run_ffmpeg(
                command, job, total_duration, progress_base=offset
            )
            last_returncode = returncode
            if stderr_tail:
                last_stderr = stderr_tail
            if job["status"] == CANCELLED:
                return returncode, stderr_tail

            current = float(job.get("current_sec") or offset)
            reached = max(0.0, min(part_duration, current - offset))
            try:
                part_ok = part_path.exists() and part_path.stat().st_size > 0
            except OSError:
                part_ok = False

            # Parça tamamlandıysa iş bitti. FFmpeg 0 ile çıktıysa ve geçerli
            # bir TS ürettiyse bu parça tamamdır.
            if returncode == 0 and part_ok:
                probed = await _probe_video_duration(part_path)
                parts.append(
                    (part_path, min(part_duration, probed or part_duration))
                )
                offset = total_duration
                break

            # Takılma veya ağ hatası: o ana kadar üretilen parçayı koru ve
            # kalan kısmı yeni bir bağlantıyla sürdür.
            if stalled or returncode != 0:
                if part_ok and reached >= MIN_RESUME_STEP_SECONDS:
                    # Video akış süresi, TS format süresindeki AAC priming
                    # farkını dışarıda bırakır; seam boşluğunu önler.
                    probed = await _probe_video_duration(part_path)
                    part_end = min(
                        part_duration,
                        probed if probed is not None else reached,
                    )
                    if part_end < MIN_RESUME_STEP_SECONDS:
                        part_end = reached
                    parts.append((part_path, part_end))
                    offset = _next_resume_offset(offset, part_end, total_duration)
                    no_progress_attempts = 0
                    logger.warning(
                        "export: akış %.1f sn'de yeniden başlatılacak (%d. deneme)",
                        offset,
                        attempts,
                    )
                else:
                    no_progress_attempts += 1
                    logger.warning(
                        "export: akış ilerlemedi; yeni bağlantı denenecek (%d/%d)",
                        no_progress_attempts,
                        MAX_NO_PROGRESS_ATTEMPTS,
                    )
                    if no_progress_attempts >= MAX_NO_PROGRESS_ATTEMPTS:
                        break
                    await asyncio.sleep(1.0)

                if attempts >= MAX_RESUME_ATTEMPTS:
                    break
                continue

            # FFmpeg başarılı görünüp parça üretmediyse de yeniden dene.
            no_progress_attempts += 1
            if no_progress_attempts >= MAX_NO_PROGRESS_ATTEMPTS:
                break
            await asyncio.sleep(1.0)

        if job["status"] == CANCELLED:
            return -1, ""
        if offset < total_duration - 0.05 or not parts:
            return last_returncode, last_stderr

        concat_path = temp_dir / "concat.txt"
        concat_path.write_text(_build_concat_manifest(parts), encoding="utf-8")

        job["stage"] = "merging"
        remux_command = _build_concat_remux_command(
            concat_path,
            output_path,
            total_duration,
            _export_codec(payload),
        )
        job["command"] = " ".join(remux_command)
        returncode, stderr_tail = await _run_ffmpeg_remux(remux_command, job)
        if job["status"] == CANCELLED:
            return returncode, stderr_tail
        if returncode == 0:
            job.pop("stage", None)
        return returncode, stderr_tail or last_stderr


def _export_segments(payload: dict[str, Any]) -> list[tuple[float, float]]:
    """Payload'daki kesim parçalarını doğrular, sıralar ve örtüşmeleri kırpar.

    ``segments`` yoksa (tek aralık istekleri) ``start_time``/``end_time`` tek
    parça olarak döner. Örtüşen ya da sırasız parçalar kırpılır; çok kısa
    parçalar atlanır. Böylece ardışık ffmpeg parçaları aynı kareyi iki kez
    yazmaz.
    """
    raw = payload.get("segments")
    if isinstance(raw, list) and raw:
        # Parça listesi verildiyse yalnızca geçerli parçalar kullanılır; boş
        # sonuç "dışa aktarılacak içerik yok" anlamına gelir, tüm pencere değil.
        candidates: list[tuple[float, float]] = []
        for item in raw[:MAX_EXPORT_SEGMENTS]:
            if not isinstance(item, dict):
                continue
            start = max(0.0, parse_time_to_seconds(item.get("start_time", 0)))
            end = max(0.0, parse_time_to_seconds(item.get("end_time", 0)))
            if end - start >= MIN_SEGMENT_DURATION:
                candidates.append((start, end))
    else:
        start = parse_time_to_seconds(payload.get("start_time", 0))
        end = parse_time_to_seconds(payload.get("end_time", 0))
        candidates = [(start, end)] if end - start >= MIN_CLIP_DURATION else []

    candidates.sort(key=lambda item: item[0])
    segments: list[tuple[float, float]] = []
    for start, end in candidates:
        if segments and start < segments[-1][1]:
            start = segments[-1][1]
        if end - start < MIN_SEGMENT_DURATION:
            continue
        segments.append((start, end))
    return segments


def _segments_duration(segments: list[tuple[float, float]]) -> float:
    """Parçaların toplam süresi (çıktı süresi)."""
    return sum(end - start for start, end in segments)


async def align_live_timeline(
    payload: dict[str, Any],
    segments: list[tuple[float, float]],
    client: Any,
) -> tuple[dict[str, Any], list[tuple[float, float]], float, Any]:
    """Canlı/DVR kaynakta istemci zaman çizelgesini güncel pencereye taşır.

    Oynatıcı (hls.js) zaman çizelgesini **ilk okuduğu playlist'in ilk
    segmentinde** sıfırlar ve kayan pencere ilerledikçe bu çizgi büyümeye
    devam eder. Dışa aktarma ise playlist'i yeniden okur; bu yüzden FFmpeg'in
    `-ss` değeri ve segment eşlemesi **güncel** pencere başına göre yapılır.

    İstemci, klibin başladığı segmentin medya sırasını ve o segmentin kendi
    zaman çizelgesindeki başlangıcını (`anchor`) bildirir. Kayma, aynı
    segmentin güncel penceredeki başlangıcından hesaplanır; böylece pencere
    kaymış olsa da klip doğru içeriğe düşer.

    Dönüş: `(payload, segments, kayma, playlist_anlık_görüntüsü)`. Kayma
    uygulanamıyorsa (VOD kaynak, bağlantı yok) değerler değişmeden döner.
    Anlık görüntü indirme adımına geçirilmelidir; pencere her birkaç saniyede
    kaydığı için yeniden okumak klibi bir segment kaydırır.
    """
    anchor = payload.get("anchor")

    # Bağlantı noktası tek seferliktir: yeniden denemelerde/parçalarda
    # ikinci kez uygulanmaması için payload'dan çıkarılır.
    cleaned = {key: value for key, value in payload.items() if key != "anchor"}
    if not isinstance(anchor, dict) or client is None or not segments:
        return cleaned, segments, 0.0, None

    url = str(payload.get("url", "")).strip()
    if not url.startswith(("http://", "https://")) or local_path(url) is not None:
        return cleaned, segments, 0.0, None

    token_headers = get_headers(payload.get("header_token"))
    user_headers = sanitize_headers(payload.get("headers"))
    headers = {**token_headers, **user_headers} or None

    try:
        shift, playlist = await live_timeline_shift(
            client,
            url,
            anchor,
            headers,
            start=segments[0][0],
            end=segments[-1][1],
        )
    except LiveTimelineError as exc:
        raise ExportError(str(exc)) from exc

    if not shift:
        return cleaned, segments, 0.0, None

    staged = dict(cleaned)
    for key in ("start_time", "end_time"):
        try:
            staged[key] = max(0.0, float(payload.get(key) or 0) + shift)
        except (TypeError, ValueError):
            continue

    raw_segments = payload.get("segments")
    if isinstance(raw_segments, list) and raw_segments:
        moved: list[dict[str, float]] = []
        for item in raw_segments:
            if not isinstance(item, dict):
                continue
            try:
                moved.append(
                    {
                        "start_time": max(
                            0.0, float(item.get("start_time") or 0) + shift
                        ),
                        "end_time": max(0.0, float(item.get("end_time") or 0) + shift),
                    }
                )
            except (TypeError, ValueError):
                continue
        if moved:
            staged["segments"] = moved

    logger.info("export: canlı zaman çizgisi %.1f sn kaydırıldı", shift)
    return (
        staged,
        [(start + shift, end + shift) for start, end in segments],
        shift,
        playlist,
    )


async def _run_segmented_export(
    payload: dict[str, Any],
    output_path: Path,
    job: dict[str, Any],
    gpu_encoder: Optional[str] = None,
) -> tuple[int, str]:
    """Çoklu kesimi parça parça işleyip tek MP4'te birleştirir.

    Her kesim ayrı bir MPEG-TS dosyasına yazılır (kopyalama ya da yeniden
    kodlama) ve sonunda concat demuxer ile tek dosyaya dönüştürülür. Segment
    bazlı ``speed``/``effects`` alanları ileride tam bu adımda uygulanacak:
    parça komutu ve concat manifesti zaten segment başına üretiliyor.
    """
    segments = _export_segments(payload)
    if len(segments) < 2:
        raise ExportError(t("error.invalidRange"))

    total_duration = max(MIN_CLIP_DURATION, _segments_duration(segments))
    base_start = segments[0][0]
    #: (parça yolu, concat demuxer için video süresi)
    parts: list[tuple[Path, float]] = []
    last_returncode = -1
    last_stderr = ""

    with tempfile.TemporaryDirectory(prefix="clip-export-") as temp_root:
        temp_dir = Path(temp_root)
        offset = 0.0
        for index, (segment_start, segment_end) in enumerate(segments, start=1):
            if job["status"] == CANCELLED:
                return -1, ""

            part_duration = segment_end - segment_start
            part_path = temp_dir / f"segment_{index:03d}.ts"
            # Yerelleştirilmiş kaynakta seek dosya başına göre kaydırılır;
            # `end_time` parçanın kendi sonuna çekilir.
            part_payload = _resume_payload(
                payload, segment_start, segment_start - base_start
            )
            part_payload["end_time"] = segment_end
            command = build_ffmpeg_command(
                part_payload,
                part_path,
                gpu_encoder=gpu_encoder,
                intermediate=True,
            )
            job["command"] = " ".join(command)
            job["stage"] = "segment"
            job["segment_index"] = index
            job["segment_count"] = len(segments)
            job["current_sec"] = round(offset, 2)

            returncode, stderr_tail, _stalled = await _run_ffmpeg(
                command, job, total_duration, progress_base=offset
            )
            last_returncode = returncode
            if stderr_tail:
                last_stderr = stderr_tail
            if job["status"] == CANCELLED:
                return returncode, stderr_tail

            try:
                part_ok = part_path.exists() and part_path.stat().st_size > 0
            except OSError:
                part_ok = False
            if returncode != 0 or not part_ok:
                return returncode, stderr_tail

            probed = await _probe_video_duration(part_path)
            parts.append(
                (part_path, min(part_duration, probed or part_duration))
            )
            offset += part_duration

        if job["status"] == CANCELLED:
            return -1, ""

        concat_path = temp_dir / "concat.txt"
        concat_path.write_text(_build_concat_manifest(parts), encoding="utf-8")

        job.pop("segment_index", None)
        job["stage"] = "merging"
        remux_command = _build_concat_remux_command(
            concat_path,
            output_path,
            total_duration,
            _export_codec(payload),
        )
        job["command"] = " ".join(remux_command)
        returncode, stderr_tail = await _run_ffmpeg_remux(remux_command, job)
        if job["status"] == CANCELLED:
            return returncode, stderr_tail
        if returncode == 0:
            job.pop("stage", None)
        return returncode, stderr_tail or last_stderr


async def run_export_job(job: dict[str, Any], manager, client: Any = None) -> None:
    """İşi arka planda yürütür; durumu job sözlüğü üzerinden raporlar."""
    set_language(job.get("lang"))
    payload = job["payload"]
    job["status"] = RUNNING
    job["progress"] = 0.0
    job.pop("eta_sec", None)
    job["started_at"] = time.time()
    downloads: list[DownloadedMedia] = []

    try:
        output_format = str(payload.get("output_format", "mp4")).lower()
        segments = _export_segments(payload)
        if not segments:
            raise ExportError(t("error.invalidRange"))
        if len(segments) > 1 and output_format != "mp4":
            raise ExportError(t("error.multiSegmentMp4Only"))

        # Canlı/DVR kaynakta istemci zaman çizelgesi güncel pencereden geride
        # kalır; klip sınırları indirme öncesinde pencereye taşınır.
        timeline_start, timeline_end = segments[0][0], segments[-1][1]
        payload, segments, timeline_shift, live_playlist = await align_live_timeline(
            payload, segments, client
        )
        if not segments:
            raise ExportError(t("error.invalidRange"))

        # Pencere = ilk parçanın başı → son parçanın sonu; süre = kalan parçalar.
        start = segments[0][0]
        end = segments[-1][1]
        clip_duration = _segments_duration(segments)
        if clip_duration < MIN_CLIP_DURATION:
            raise ExportError(t("error.invalidRange"))
        if len(segments) == 1:
            # Tek parça: komut, istemcinin ham `start_time`/`end_time` değeri
            # yerine doğrulanmış parçadan üretilir (kırpma/örtüşme düzeltmesi).
            payload = {
                **payload,
                "start_time": segments[0][0],
                "end_time": segments[0][1],
            }

        output_path = build_output_path(
            str(payload.get("filename", "")),
            output_format,
        )

        # Yerel dosyada kırpma/kesim yoksa yeniden kodlamak zaman kaybıdır:
        # akış olduğu gibi kopyalanır ve dışa aktarma saniyeler yerine anlık
        # tamamlanır. Kodek denetimi de bu kararın içindedir.
        auto_copy = await local_copy_eligible(payload, segments)
        if auto_copy:
            payload = {**payload, "mode": "fast"}
            job["auto_copy"] = True

        job["output_path"] = str(output_path)
        job["output_filename"] = output_path.name
        job["clip_duration"] = round(clip_duration, 3)
        #: Arayüzde paralel iş kartlarını ayırt etmek için kısa bilgiler.
        #: Canlı kaynakta kart, kullanıcının gördüğü zaman çizelgesi değerlerini
        #: gösterir (indirme için pencereye kaydırılan değerler değil).
        job["clip_start"] = round(timeline_start, 3)
        job["clip_end"] = round(timeline_end, 3)
        if timeline_shift:
            job["timeline_shift"] = round(timeline_shift, 3)
        if len(segments) > 1:
            job["segment_count"] = len(segments)
        job["output_format"] = output_format
        job["mode"] = str(payload.get("mode", "exact")).lower()
        job["quality"] = _quality_profile(payload)[0]
        job["codec"] = _export_codec(payload)
        job["output_fps"] = _output_fps(payload)
        job["encoder_requested"] = (
            "gpu" if str(payload.get("encoder", "cpu")).strip().lower() == "gpu" else "cpu"
        )

        if client is not None:
            job["stage"] = "staging"
            try:
                payload, downloads = await stage_hls_sources(
                    payload, client, start, end, playlist=live_playlist
                )
            except Exception as exc:  # yerelleştirme başarısızsa eski yola dön
                logger.warning("export: HLS yerelleştirme hatası: %s", exc)
                # Canlı kaynakta payload zaten pencereye hizalanmıştı; özgün
                # (hizasız) kopyaya dönmek klibi yanlış konuma taşır.
                for media in downloads:
                    media.cleanup()
                downloads = []
            finally:
                job.pop("stage", None)
            job["localized"] = bool(downloads)
            if live_playlist is not None and not downloads:
                # Canlı playlist'te FFmpeg'in `-ss` değeri yok sayılır ve her
                # zaman canlı uçtan okunur. Aralık yerelleştirilemiyorsa yanlış
                # klip üretmek yerine açık bir hata verilir.
                raise ExportError(t("error.liveRangeUnavailable"))
            if job["status"] == CANCELLED:
                return

        gpu_encoder: Optional[str] = None
        fallback_reason: Optional[str] = None
        fallback_detail: Optional[str] = None
        gpu_label: Optional[str] = None
        if auto_copy:
            # Kopyalama yolunda kodlayıcı yok; GPU isteği sessizce düşer.
            # `select_gpu_encoder` çağrılsaydı "uygun değil" uyarısı kartta
            # gereksiz bir CPU'ya dönüş notu olarak görünürdü.
            job["encoder_requested"] = "cpu"
        else:
            gpu_encoder, fallback_reason, fallback_detail, gpu_label = (
                await select_gpu_encoder(payload)
            )
        if job["status"] == CANCELLED:
            return

        job["encoder_used"] = "gpu" if gpu_encoder else "cpu"
        job["gpu_encoder"] = gpu_encoder
        job["gpu_label"] = gpu_label
        if fallback_reason:
            job["gpu_fallback"] = True
            job["gpu_fallback_reason"] = fallback_reason
            if fallback_detail:
                job["gpu_fallback_detail"] = fallback_detail[-600:]

        command = build_ffmpeg_command(payload, output_path, gpu_encoder=gpu_encoder)
        job["command"] = " ".join(command)

        resumable = _can_resume(payload)
        if len(segments) > 1:
            # Çoklu kesim: boşluklar atlanır, parçalar birleştirilir.
            returncode, stderr_tail = await _run_segmented_export(
                payload, output_path, job, gpu_encoder=gpu_encoder
            )
        elif resumable:
            returncode, stderr_tail = await _run_resumable_export(
                payload, output_path, job, gpu_encoder=gpu_encoder
            )
        else:
            returncode, stderr_tail, _stalled = await _run_ffmpeg(
                command, job, clip_duration
            )
        if job["status"] == CANCELLED:
            return

        if returncode == 0 and output_path.exists():
            _mark_done(job, output_path)
            await _warm_thumbnail(output_path)
            return

        # GPU kodlayıcı sürücü/oturum hatası verirse aynı işi CPU ile yeniden dene.
        # Yarım dosya silinir; iş kartında CPU'ya dönüş nedeni gösterilir.
        if gpu_encoder:
            _remove_partial_output(output_path)
            if job["status"] == CANCELLED:
                return

            job["gpu_fallback"] = True
            job["gpu_fallback_reason"] = t("gpu.fallback.failed")
            if stderr_tail:
                job["gpu_fallback_detail"] = stderr_tail[-600:]
            job["encoder_used"] = "cpu"
            job["gpu_encoder"] = None
            job["gpu_label"] = None
            job["progress"] = 0.0
            job["current_sec"] = 0.0
            job["speed"] = None
            job.pop("eta_sec", None)

            cpu_command = build_ffmpeg_command(payload, output_path)
            job["command"] = " ".join(cpu_command)
            if len(segments) > 1:
                returncode, stderr_tail = await _run_segmented_export(
                    payload, output_path, job, gpu_encoder=None
                )
            elif resumable:
                returncode, stderr_tail = await _run_resumable_export(
                    payload, output_path, job, gpu_encoder=None
                )
            else:
                returncode, stderr_tail, _stalled = await _run_ffmpeg(
                    cpu_command, job, clip_duration
                )
            if job["status"] == CANCELLED:
                return
            if returncode == 0 and output_path.exists():
                _mark_done(job, output_path)
                await _warm_thumbnail(output_path)
                return

        _remove_partial_output(output_path)
        job["status"] = ERROR
        job["error"] = stderr_tail[-600:] if stderr_tail else t("error.ffmpegExportFailed")

    except ExportError as exc:
        job["status"] = ERROR
        job["error"] = str(exc)
    except Exception as exc:  # beklenmedik hata — işi yine de sonlandır
        if job["status"] != CANCELLED:
            job["status"] = ERROR
            job["error"] = str(exc)
    finally:
        for media in downloads:
            media.cleanup()
        downloads.clear()


def _parse_speed(raw: Any) -> Optional[float]:
    """FFmpeg'in ``1.25x`` biçimindeki hız değerini sayıya çevirir."""
    text = str(raw or "").strip().lower()
    if not text.endswith("x"):
        return None
    try:
        speed = float(text[:-1])
    except ValueError:
        return None
    return speed if speed > 0 else None


def _update_eta(job: dict[str, Any], clip_duration: float) -> None:
    """İşlenen süre ve FFmpeg hızından yaklaşık kalan saniyeyi hesaplar.

    Hız bilgisi yoksa ETA üretilmez; yarım kalan bir önceki değer de temizlenir.
    """
    current_sec = job.get("current_sec")
    speed = _parse_speed(job.get("speed"))
    if current_sec is None or speed is None:
        job.pop("eta_sec", None)
        return

    remaining = max(0.0, clip_duration - float(current_sec))
    job["eta_sec"] = round(remaining / speed, 1) if remaining > 0 else 0.0


async def _read_progress(
    process,
    job: dict[str, Any],
    total_duration: float,
    progress_base: float = 0.0,
    progress_floor: float = 0.0,
) -> None:
    """ffmpeg'in -progress pipe:1 çıktısını ayrıştırıp iş durumunu günceller.

    Parçalı dışa aktarmada her FFmpeg süreci kendi dosyası için 0'dan başlar.
    ``progress_base`` parçanın toplam klipteki başlangıcını ekler; böylece iş
    kartındaki ilerleme başa dönmez.
    """
    assert process.stdout is not None
    while True:
        raw = await process.stdout.readline()
        if not raw:
            break
        line = raw.decode("utf-8", errors="ignore").strip()

        if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
            try:
                seconds = int(line.split("=", 1)[1]) / 1_000_000
            except ValueError:
                continue
            global_seconds = min(
                total_duration, max(progress_floor, progress_base + seconds)
            )
            job["current_sec"] = round(global_seconds, 2)
            job["progress"] = round(
                min(99.0, max(0.0, global_seconds / total_duration * 100)), 1
            )
            _update_eta(job, total_duration)
        elif line.startswith("speed="):
            job["speed"] = line.split("=", 1)[1].strip()
            _update_eta(job, total_duration)
        elif line == "progress=end":
            # Ara parçalarda da "progress=end" gelir; burada 100 yazmak
            # ilerlemeyi erken doldurur. Nihai %100'ü _mark_done belirler.
            if float(job.get("current_sec") or 0.0) >= total_duration - 0.05:
                job["eta_sec"] = 0.0
