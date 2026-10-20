"""Dalga formu uç noktası: kaynağın ses tepe değerlerini (önbellekli) döner.

İstek gövdesi:
    {"url": "<oynatılan akış>", "origin": "<master m3u8 (varsa)>",
     "duration": 634.5, "force": false, "audio_url": "<ses-yalnız akış>"}

`origin` verilirse ve bir master playlist ise ses grubu ya da en hafif varyant
üzerinden çıkarım yapılır; böylece tam video indirilmez. `audio_url` verilirse
(o akış sessiz bir videoya aitse) doğrudan o ses akışı kullanılır.
"""
from starlette.responses import JSONResponse
from starlette.routing import Route

from services.request_headers import sanitize_headers
from services.waveform import WaveformError, build_waveform


async def waveform_endpoint(request):
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": "Geçersiz istek gövdesi."}, status_code=400)

    url = str(data.get("url", "")).strip()
    if not url:
        return JSONResponse({"success": False, "error": "URL boş bırakılamaz."}, status_code=400)

    try:
        duration = float(data.get("duration") or 0.0)
    except (TypeError, ValueError):
        duration = 0.0

    origin = data.get("origin")
    origin = origin.strip() if isinstance(origin, str) and origin.strip() else None

    audio_url = data.get("audio_url")
    audio_url = audio_url.strip() if isinstance(audio_url, str) and audio_url.strip() else None

    try:
        payload = await build_waveform(
            url,
            duration=duration,
            origin=origin,
            force=bool(data.get("force")),
            client=getattr(request.app.state, "http", None),
            audio_url=audio_url,
            headers=sanitize_headers(data.get("headers")),
        )
    except WaveformError as exc:
        return JSONResponse({"success": False, "error": str(exc)}, status_code=exc.status_code)

    return JSONResponse(payload)


routes = [
    Route("/api/waveform", waveform_endpoint, methods=["POST"]),
]
