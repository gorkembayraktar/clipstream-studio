"""ffprobe ile uzak medya analizi."""
import asyncio
import json
from typing import Any

from config import USER_AGENT
from core.i18n import t
from services.local_media import local_path
from services.request_headers import ffmpeg_input_args


class ProbeError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


async def probe_url(url: str, headers: Any = None) -> dict[str, Any]:
    """Verilen URL'yi ffprobe ile analiz eder; normalize edilmiş sözlük döner.

    `headers`: curl ile yapıştırılan HTTP başlıkları (cookie/referer…);
    yalnızca uzak kaynaklarda ffprobe'a aktarılır.
    """
    # Yerel kaynak (/uploads/...) ise dosya doğrudan okunur: ağ turu olmaz.
    source = str(local_path(url) or url)
    command = [
        "ffprobe",
        "-v", "error",
        "-probesize", "15000000",
        "-analyzeduration", "15000000",
    ]
    if source.startswith(("http://", "https://")):
        command += ffmpeg_input_args(headers, USER_AGENT)
    command += [
        "-show_entries",
        "format=duration,size,bit_rate,format_name:stream=width,height,r_frame_rate,avg_frame_rate,codec_name,codec_type,duration",
        "-of", "json",
        source,
    ]

    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=20.0)
    except asyncio.TimeoutError:
        try:
            process.kill()
        except Exception:
            pass
        # Süreç yeniden toplanmazsa boru taşıyıcısı ve tanıtıcı açık kalır.
        try:
            await process.wait()
        except Exception:
            pass
        raise ProbeError(
            t("error.probeTimeout"),
            status_code=504,
        ) from None

    if process.returncode != 0:
        message = stderr.decode("utf-8", errors="ignore").strip()
        raise ProbeError(message or t("error.probeFailed"))

    info = json.loads(stdout.decode("utf-8", errors="ignore"))
    video = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
    audio = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), None)

    duration = _to_float(info.get("format", {}).get("duration"))
    if duration <= 0 and video:
        duration = _to_float(video.get("duration"))
    size_bytes = int(_to_float(info.get("format", {}).get("size")))
    stream = video or audio

    return {
        "success": True,
        "duration": round(duration, 3),
        "size_bytes": size_bytes,
        "size_mb": round(size_bytes / (1024 * 1024), 2) if size_bytes else 0,
        "width": int((video or {}).get("width") or 0),
        "height": int((video or {}).get("height") or 0),
        "fps": round(_to_rate((video or {}).get("r_frame_rate")) or _to_rate((video or {}).get("avg_frame_rate")), 3),
        # Ses-only dosyalarda da anlamlı bir codec adı döndür.
        "codec": (stream or {}).get("codec_name", "unknown"),
        "has_audio": audio is not None,
        "has_video": video is not None,
        "format_name": info.get("format", {}).get("format_name", ""),
        "raw": info,
    }


def _to_rate(value: Any) -> float:
    """'30000/1001' biçimindeki kare hızını ondalığa çevirir (kare adımı için)."""
    try:
        text = str(value or "").strip()
        if not text or text in {"0/0", "N/A"}:
            return 0.0
        if "/" in text:
            numerator, denominator = text.split("/", 1)
            rate = float(numerator) / float(denominator)
        else:
            rate = float(text)
        return rate if rate > 0 else 0.0
    except (TypeError, ValueError, ZeroDivisionError):
        return 0.0


def _to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0
