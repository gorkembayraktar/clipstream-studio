"""Dışa aktarma yetenekleri: GPU kodlayıcı var mı, hangisi kullanılabilir?"""
from starlette.responses import JSONResponse
from starlette.routing import Route

from core.i18n import t
from services.gpu import detect_gpu_capability


async def export_capabilities_endpoint(request):
    capability = await detect_gpu_capability()
    encoder = capability.encoder

    gpu = {
        "available": encoder is not None,
        "encoder": encoder.name if encoder else None,
        "label": encoder.label if encoder else None,
        "reason": t(capability.reason_key) if capability.reason_key else None,
        "detail": capability.detail,
    }
    return JSONResponse({"success": True, "gpu": gpu})


routes = [
    Route("/api/export/capabilities", export_capabilities_endpoint, methods=["GET"]),
]
