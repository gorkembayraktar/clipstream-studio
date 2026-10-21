"""FFmpeg dışa aktarma işçisi: komutu kurar, çalıştırır ve ilerlemeyi raporlar."""
import asyncio
import re
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
from services.local_media import local_path
from services.request_headers import ffmpeg_input_args

MIN_CLIP_DURATION = 0.1


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
) -> list[str]:
    """Payload'dan ffmpeg komutunu üretir (saf fonksiyon, test edilebilir).

    `gpu_encoder` yalnızca çağıran taraf yeteneği doğruladıktan sonra verilir;
    hızlı kopyalama, GIF ve MP3 çıktılarında yok sayılır.
    """
    url = str(payload.get("url", "")).strip()
    if not url:
        raise ExportError(t("error.sourceEmpty"))

    # Yerel dosya (/uploads/...) ise ffmpeg dosyayı doğrudan okur: ağ turu olmaz.
    url = str(local_path(url) or url)

    # Video akışı sessizse (YouTube HLS) ses ayrı bir akıştan gelir.
    audio_url = str(payload.get("audio_url") or "").strip()
    if audio_url and ".m3u8" not in audio_url.lower() and "://" not in audio_url:
        audio_url = ""
    if audio_url:
        audio_url = str(local_path(audio_url) or audio_url)

    start = parse_time_to_seconds(payload.get("start_time", 0))
    end = parse_time_to_seconds(payload.get("end_time", 0))
    if end <= start:
        raise ExportError(t("error.endAfterStart"))

    clip_duration = end - start
    output_format = str(payload.get("output_format", "mp4")).lower()
    mode = str(payload.get("mode", "exact")).lower()
    crop = _normalized_crop(payload.get("crop"))
    use_gpu = is_gpu_render_eligible(output_format, mode, crop) and bool(gpu_encoder)
    if use_gpu and get_gpu_encoder(gpu_encoder or "") is None:
        raise ExportError(t("error.gpuEncoderInvalid", encoder=gpu_encoder))

    # MP3'te ses tek başına yeterli: kaynak sessizse doğrudan ses akışı kullanılır.
    if output_format == "mp3" and audio_url:
        url = audio_url

    # Ses birleştirme yalnızca MP4 çıktısında ve ses akışı ayrı verildiğinde yapılır.
    merge_audio = bool(audio_url) and output_format == "mp4" and url != audio_url

    command = ["ffmpeg", "-y", "-nostdin", "-progress", "pipe:1"]
    # curl ile yapıştırılan başlıklar (cookie/referer…) iki girişe de uygulanır.
    input_args = ffmpeg_input_args(payload.get("headers"), USER_AGENT)
    if url.startswith(("http://", "https://")):
        command += input_args

    command += ["-ss", seconds_to_hms(start), "-i", url]

    if merge_audio:
        if audio_url.startswith(("http://", "https://")):
            command += input_args
        command += ["-ss", seconds_to_hms(start), "-i", audio_url]

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
        filters = []
        if crop:
            filters.append(f"crop={crop['width']}:{crop['height']}:{crop['x']}:{crop['y']}")
        filters.append("fps=15,scale=480:-1:flags=lanczos")
        graph = ",".join(filters) + ",split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"
        command += ["-vf", graph]

    elif output_format == "mp3":
        command += ["-vn", "-c:a", "libmp3lame", "-q:a", "2"]

    elif crop or mode != "fast":
        # Hassas kesim (gerekirse crop ile birlikte) — kare hassasiyetinde yeniden kodlama
        if crop:
            command += ["-vf", f"crop={crop['width']}:{crop['height']}:{crop['x']}:{crop['y']}"]
        if use_gpu:
            command += gpu_encoder_arguments(gpu_encoder or "")
        else:
            command += [
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "21" if crop else "20",
            ]
        command += [
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "192k",
            "-movflags", "+faststart",
        ]

    else:
        # Hızlı kesim — yeniden kodlama yok, anahtar kareye hizalı
        command += ["-c", "copy", "-avoid_negative_ts", "make_zero"]
        if ".m3u8" in url.lower() and not merge_audio:
            command += ["-bsf:a", "aac_adtstoasc"]

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


async def _run_ffmpeg(
    command: list[str], job: dict[str, Any], clip_duration: float
) -> tuple[int, str]:
    """FFmpeg'i çalıştırır; ilerlemeyi günceller ve stderr kuyruğunu döndürür."""
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    job["process"] = process

    await asyncio.gather(_read_progress(process, job, clip_duration), process.wait())

    stderr_tail = ""
    if process.stderr is not None:
        stderr_tail = (await process.stderr.read()).decode("utf-8", errors="ignore").strip()
    return process.returncode, stderr_tail


async def run_export_job(job: dict[str, Any], manager) -> None:
    """İşi arka planda yürütür; durumu job sözlüğü üzerinden raporlar."""
    set_language(job.get("lang"))
    payload = job["payload"]
    job["status"] = RUNNING
    job["progress"] = 0.0
    job["started_at"] = time.time()

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
        job["encoder_requested"] = (
            "gpu" if str(payload.get("encoder", "cpu")).strip().lower() == "gpu" else "cpu"
        )

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

        returncode, stderr_tail = await _run_ffmpeg(command, job, end - start)
        if job["status"] == CANCELLED:
            return

        if returncode == 0 and output_path.exists():
            _mark_done(job, output_path)
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

            cpu_command = build_ffmpeg_command(payload, output_path)
            job["command"] = " ".join(cpu_command)
            returncode, stderr_tail = await _run_ffmpeg(cpu_command, job, end - start)
            if job["status"] == CANCELLED:
                return
            if returncode == 0 and output_path.exists():
                _mark_done(job, output_path)
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


async def _read_progress(process, job: dict[str, Any], clip_duration: float) -> None:
    """ffmpeg'in -progress pipe:1 çıktısını ayrıştırıp iş durumunu günceller."""
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
            job["current_sec"] = round(seconds, 2)
            job["progress"] = round(min(99.0, max(0.0, seconds / clip_duration * 100)), 1)
        elif line.startswith("speed="):
            job["speed"] = line.split("=", 1)[1].strip()
        elif line == "progress=end":
            job["progress"] = 100.0
