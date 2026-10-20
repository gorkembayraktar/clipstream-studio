"""Önizleme karesi uç noktası: videoyu ilerletmeden tek kare döner.

İstek gövdesi:
    {"url": "<oynatılan akış>", "origin": "<master m3u8 (varsa)>", "time": 123.4}

Yanıt: image/jpeg (hata durumunda JSON).
"""
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from core.i18n import t
from services.frames import FrameError, build_frame
from services.request_headers import sanitize_headers


async def frame_endpoint(request):
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": t("error.invalidBody")}, status_code=400)

    url = str(data.get("url", "")).strip()
    if not url:
        return JSONResponse({"success": False, "error": t("error.urlEmpty")}, status_code=400)

    try:
        time = float(data.get("time") or 0.0)
    except (TypeError, ValueError):
        time = 0.0

    origin = data.get("origin")
    origin = origin.strip() if isinstance(origin, str) and origin.strip() else None

    try:
        image = await build_frame(
            url,
            time,
            origin=origin,
            client=getattr(request.app.state, "http", None),
            headers=sanitize_headers(data.get("headers")),
        )
    except FrameError as exc:
        return JSONResponse({"success": False, "error": str(exc)}, status_code=exc.status_code)

    return Response(
        content=image,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=3600"},
    )


routes = [
    Route("/api/frame", frame_endpoint, methods=["POST"]),
]
