"""Dışa aktarma yetenekleri: GPU, H.265 ve kare hızı desteği."""
from starlette.responses import JSONResponse
from starlette.routing import Route

from core.i18n import t
from services.codecs import detect_hevc_support
from services.gpu import detect_gpu_capability


async def export_capabilities_endpoint(request):
    capability = await detect_gpu_capability()
    encoder = capability.encoder
    try:
        hevc_available = await detect_hevc_support()
    except Exception:
        hevc_available = False

    gpu = {
        "available": encoder is not None,
        "encoder": encoder.name if encoder else None,
        "label": encoder.label if encoder else None,
        "reason": t(capability.reason_key) if capability.reason_key else None,
        "detail": capability.detail,
    }
    return JSONResponse(
        {
            "success": True,
            "gpu": gpu,
            "features": {
                "hevc": hevc_available,
                "frame_rate": True,
            },
        }
    )


routes = [
    Route("/api/export/capabilities", export_capabilities_endpoint, methods=["GET"]),
]
