"""GPU H.264 kodlayıcı yeteneği tespiti ve seçimi.

FFmpeg'in `-encoders` listesinde bir kodlayıcının görünmesi, donanımın ve
sürücünün onu gerçekten başlatabildiği anlamına gelmez. Bu modül önce listeyi
okur, ardından her adayı minik bir sentetik kareyle dener; yalnızca başarıyla
kodlayan ilk adayı (`h264_nvenc` → `h264_qsv` → `h264_amf`) kullanıma açar.

Tespit sonucu dil bağımsızdır: hata nedeni bir çeviri anahtarı olarak tutulur,
API katmanı bunu isteğin dilinde döndürür.
"""
import asyncio
import re
import time
from dataclasses import dataclass
from typing import Optional

FFMPEG_BIN = "ffmpeg"
ENCODER_LIST_TIMEOUT = 8.0
ENCODER_PROBE_TIMEOUT = 15.0
CAPABILITY_CACHE_SECONDS = 300.0


@dataclass(frozen=True)
class GpuEncoder:
    """FFmpeg GPU kodlayıcısı ve kalite eşlemesi."""

    name: str
    label: str
    quality_args: tuple[str, ...]


#: Tercih sırası: NVENC genellikle en hızlı ve en öngörülebilir seçenektir.
GPU_ENCODERS: tuple[GpuEncoder, ...] = (
    GpuEncoder(
        name="h264_nvenc",
        label="NVIDIA NVENC",
        quality_args=(
            "-preset",
            "p4",
            "-tune",
            "hq",
            "-rc",
            "vbr",
            "-cq",
            "20",
            "-b:v",
            "0",
        ),
    ),
    GpuEncoder(
        name="h264_qsv",
        label="Intel Quick Sync",
        quality_args=("-preset", "veryfast", "-global_quality", "20"),
    ),
    GpuEncoder(
        name="h264_amf",
        label="AMD AMF",
        quality_args=(
            "-quality",
            "balanced",
            "-rc",
            "cqp",
            "-qp_i",
            "20",
            "-qp_p",
            "20",
            "-qp_b",
            "20",
        ),
    ),
)

_ENCODERS_BY_NAME = {encoder.name: encoder for encoder in GPU_ENCODERS}


@dataclass(frozen=True)
class GpuCapability:
    """Tespit sonucu: çalışan kodlayıcı ya da dil bağımsız hata nedeni."""

    encoder: Optional[GpuEncoder] = None
    reason_key: Optional[str] = None
    detail: Optional[str] = None
    checked_at: float = 0.0

    @property
    def available(self) -> bool:
        return self.encoder is not None


_capability: Optional[GpuCapability] = None
_capability_lock = asyncio.Lock()


def get_gpu_encoder(name: str) -> Optional[GpuEncoder]:
    """Ada göre kodlayıcı kaydını döndürür (bilinmeyen adda `None`)."""
    return _ENCODERS_BY_NAME.get(str(name or "").strip().lower())


def is_gpu_encoder(name: str) -> bool:
    return get_gpu_encoder(name) is not None


def gpu_encoder_arguments(name: str) -> list[str]:
    """FFmpeg komutuna eklenecek video kodlayıcı argümanları."""
    encoder = get_gpu_encoder(name)
    if encoder is None:
        raise ValueError(f"Unsupported GPU encoder: {name}")
    return ["-c:v", encoder.name, *encoder.quality_args]


async def detect_gpu_capability(force: bool = False) -> GpuCapability:
    """Çalışan GPU kodlayıcıyı tespit eder; sonucu kısa süreliğine önbelleğe alır."""
    global _capability

    now = time.time()
    if (
        not force
        and _capability is not None
        and now - _capability.checked_at < CAPABILITY_CACHE_SECONDS
    ):
        return _capability

    async with _capability_lock:
        now = time.time()
        if (
            not force
            and _capability is not None
            and now - _capability.checked_at < CAPABILITY_CACHE_SECONDS
        ):
            return _capability

        _capability = await _detect()
        return _capability


async def _detect() -> GpuCapability:
    """FFmpeg listesini okur ve adayları tek tek dener."""
    text, reason_key, detail = await _list_encoders()
    if text is None:
        return GpuCapability(reason_key=reason_key, detail=detail, checked_at=time.time())

    candidates = [
        encoder
        for encoder in GPU_ENCODERS
        if re.search(rf"\b{re.escape(encoder.name)}\b", text)
    ]
    if not candidates:
        return GpuCapability(
            reason_key="gpu.reason.buildMissing",
            detail="h264_nvenc, h264_qsv and h264_amf are not listed by ffmpeg -encoders",
            checked_at=time.time(),
        )

    failures: list[str] = []
    timed_out = False
    for encoder in candidates:
        ok, probe_detail = await _probe_encoder(encoder)
        if ok:
            return GpuCapability(encoder=encoder, checked_at=time.time())
        if probe_detail == "timeout":
            timed_out = True
        if probe_detail:
            failures.append(f"{encoder.name}: {probe_detail}")

    return GpuCapability(
        reason_key=(
            "gpu.reason.probeTimeout" if timed_out and len(failures) == len(candidates)
            else "gpu.reason.probeFailed"
        ),
        detail="; ".join(failures)[-600:] or None,
        checked_at=time.time(),
    )


async def _list_encoders() -> tuple[Optional[str], Optional[str], Optional[str]]:
    """`ffmpeg -encoders` çıktısını döndürür: (metin, neden, ayrıntı)."""
    try:
        process = await asyncio.create_subprocess_exec(
            FFMPEG_BIN,
            "-hide_banner",
            "-encoders",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        return None, "gpu.reason.ffmpegMissing", None
    except OSError as exc:
        return None, "gpu.reason.listFailed", str(exc)

    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(), timeout=ENCODER_LIST_TIMEOUT
        )
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        return None, "gpu.reason.listTimeout", None

    if process.returncode != 0:
        detail = stderr.decode("utf-8", errors="ignore").strip()
        return None, "gpu.reason.listFailed", detail[-400:] or None

    return stdout.decode("utf-8", errors="ignore"), None, None


async def _probe_encoder(encoder: GpuEncoder) -> tuple[bool, Optional[str]]:
    """Minik sentetik kareyi gerçek GPU kodlayıcıyla kodlamayı dener."""
    command = [
        FFMPEG_BIN,
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=128x128:r=1",
        "-frames:v",
        "1",
        "-an",
        *gpu_encoder_arguments(encoder.name),
        "-f",
        "null",
        "-",
    ]

    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        return False, "ffmpeg not found"
    except OSError as exc:
        return False, str(exc)

    try:
        _, stderr = await asyncio.wait_for(
            process.communicate(), timeout=ENCODER_PROBE_TIMEOUT
        )
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        return False, "timeout"

    if process.returncode == 0:
        return True, None

    detail = stderr.decode("utf-8", errors="ignore").strip()
    return False, detail[-500:] or f"exit code {process.returncode}"
