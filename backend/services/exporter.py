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
from services.request_headers import ffmpeg_input_args, sanitize_headers
from services.segment_downloader import DownloadedMedia, download_hls_range
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
#: Parçalar arasında kare atlamamak için küçük bir örtüşme bırakılır.
RESUME_OVERLAP_SECONDS = 0.25
MIN_RESUME_STEP_SECONDS = 0.5

#: Yeniden kodlanan MP4 çıktıları için kalite profilleri.
#: Dengeli profil, HD çözünürlüğü korurken x264'ün daha verimli preset'i ve
#: biraz daha yüksek CRF değeriyle tipik olarak %20-30 daha küçük dosya üretir.
DEFAULT_EXPORT_QUALITY = "balanced"
EXPORT_QUALITY_PROFILES: dict[str, dict[str, Any]] = {
    "high": {
        "preset": "veryfast",
        "crf": 20,
        "crop_crf": 21,
        "audio_bitrate": "192k",
    },
    "balanced": {
        "preset": "medium",
        "crf": 22,
        "crop_crf": 23,
        "audio_bitrate": "160k",
    },
    "compact": {
        "preset": "medium",
        "crf": 25,
        "crop_crf": 26,
        "audio_bitrate": "128k",
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

    # libx264 çift boyut ister
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


def is_gpu_render_eligible(
    output_format: str, mode: str, crop: Optional[dict[str, int]]
) -> bool:
    """GPU yalnızca yeniden kodlama gereken MP4 çıktılarında kullanılabilir."""
    return output_format == "mp4" and (crop is not None or mode != "fast")


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
    crop = _normalized_crop(payload.get("crop"))
    use_gpu = is_gpu_render_eligible(output_format, mode, crop) and bool(gpu_encoder)
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

    elif crop or mode != "fast":
        # Hassas kesim (gerekirse crop ile birlikte) — kare hassasiyetinde yeniden kodlama.
        # PTS sıfırlama, HLS/uzun akışlarda seek sonrası ilk saniyelerin donmuş
        # görünmesini önler.
        filters = ["setpts=PTS-STARTPTS"]
        if crop:
            filters.append(f"crop={crop['width']}:{crop['height']}:{crop['x']}:{crop['y']}")
        command += ["-vf", ",".join(filters)]
        command += ["-af", "asetpts=PTS-STARTPTS"]
        if use_gpu:
            command += gpu_encoder_arguments(gpu_encoder or "", quality_name)
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
        command += ["-f", "mpegts"]
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
    crop = _normalized_crop(payload.get("crop"))
    if not is_gpu_render_eligible(output_format, mode, crop):
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
) -> tuple[dict[str, Any], list[DownloadedMedia]]:
    """Dışa aktarma için HLS girişlerini istenen aralıkla yerelleştirir.

    AV1/fMP4 HLS'te FFmpeg'in uzak playlist üzerinde seek etmesi güvenilir
    değil; yalnızca klip aralığını indirip yerel dosyadan kesmek hem doğru hem
    çok daha hızlı. Uygun olmayan kaynaklarda payload değişmeden döner.
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
            client, primary_url, start, end, headers
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
    parçaları H.264/AAC taşıyabildiğinden, doğrudan kopyalama (fast) ve
    GIF/MP3 çıktıları bu yoldan geçirilmez.
    """
    output_format = str(payload.get("output_format", "mp4")).lower()
    if output_format != "mp4":
        return False
    mode = str(payload.get("mode", "exact")).lower()
    return _normalized_crop(payload.get("crop")) is not None or mode != "fast"


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
    parts: list[Path] = []
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
                parts.append(part_path)
                offset = total_duration
                break

            # Takılma veya ağ hatası: o ana kadar üretilen parçayı koru ve
            # kalan kısmı yeni bir bağlantıyla sürdür.
            if stalled or returncode != 0:
                if part_ok and reached >= MIN_RESUME_STEP_SECONDS:
                    parts.append(part_path)
                    offset = min(
                        total_duration,
                        offset + max(0.0, reached - RESUME_OVERLAP_SECONDS),
                    )
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
        concat_lines = []
        for part in parts:
            part_text = part.as_posix().replace("'", "'\\''")
            concat_lines.append(f"file '{part_text}'")
        concat_path.write_text("\n".join(concat_lines) + "\n", encoding="utf-8")

        job["stage"] = "merging"
        remux_command = [
            "ffmpeg",
            "-y",
            "-nostdin",
            "-nostats",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_path),
            "-c",
            "copy",
            "-t",
            seconds_to_hms(total_duration),
            "-movflags",
            "+faststart",
            str(output_path),
        ]
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
        start = parse_time_to_seconds(payload.get("start_time", 0))
        end = parse_time_to_seconds(payload.get("end_time", 0))
        if end - start < MIN_CLIP_DURATION:
            raise ExportError(t("error.invalidRange"))

        output_path = build_output_path(
            str(payload.get("filename", "")),
            str(payload.get("output_format", "mp4")).lower(),
        )
        job["output_path"] = str(output_path)
        job["output_filename"] = output_path.name
        job["clip_duration"] = round(end - start, 3)
        #: Arayüzde paralel iş kartlarını ayırt etmek için kısa bilgiler.
        job["clip_start"] = round(start, 3)
        job["clip_end"] = round(end, 3)
        job["output_format"] = str(payload.get("output_format", "mp4")).lower()
        job["mode"] = str(payload.get("mode", "exact")).lower()
        job["quality"] = _quality_profile(payload)[0]
        job["encoder_requested"] = (
            "gpu" if str(payload.get("encoder", "cpu")).strip().lower() == "gpu" else "cpu"
        )

        if client is not None:
            job["stage"] = "staging"
            try:
                payload, downloads = await stage_hls_sources(payload, client, start, end)
            except Exception as exc:  # yerelleştirme başarısızsa eski yola dön
                logger.warning("export: HLS yerelleştirme hatası: %s", exc)
                payload = job["payload"]
                for media in downloads:
                    media.cleanup()
                downloads = []
            finally:
                job.pop("stage", None)
            job["localized"] = bool(downloads)
            if job["status"] == CANCELLED:
                return

        gpu_encoder, fallback_reason, fallback_detail, gpu_label = await select_gpu_encoder(
            payload
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
        if resumable:
            returncode, stderr_tail = await _run_resumable_export(
                payload, output_path, job, gpu_encoder=gpu_encoder
            )
        else:
            returncode, stderr_tail, _stalled = await _run_ffmpeg(
                command, job, end - start
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
            if resumable:
                returncode, stderr_tail = await _run_resumable_export(
                    payload, output_path, job, gpu_encoder=None
                )
            else:
                returncode, stderr_tail, _stalled = await _run_ffmpeg(
                    cpu_command, job, end - start
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
