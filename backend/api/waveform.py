"""Dalga formu uç noktası: kaynağın ses tepe değerlerini (önbellekli) döner.

İstek gövdesi:
    {"url": "<oynatılan akış>", "origin": "<master m3u8 (varsa)>",
     "duration": 634.5, "force": false, "audio_url": "<ses-yalnız akış>"}

`origin` verilirse ve bir master playlist ise ses grubu ya da en hafif varyant
üzerinden çıkarım yapılır; böylece tam video indirilmez. `audio_url` verilirse
(o akış sessiz bir videoya aitse) doğrudan o ses akışı kullanılır.
"""
import json

from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

from core.i18n import t
from services.request_headers import sanitize_headers
from services.waveform import WaveformError, build_waveform, stream_waveform


async def waveform_endpoint(request):
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": t("error.invalidBody")}, status_code=400)

    url = str(data.get("url", "")).strip()
    if not url:
        return JSONResponse({"success": False, "error": t("error.urlEmpty")}, status_code=400)

    try:
        duration = float(data.get("duration") or 0.0)
    except (TypeError, ValueError):
        duration = 0.0

    origin = data.get("origin")
    origin = origin.strip() if isinstance(origin, str) and origin.strip() else None

    audio_url = data.get("audio_url")
    audio_url = audio_url.strip() if isinstance(audio_url, str) and audio_url.strip() else None

    audio_track = data.get("audio_track")
    audio_track = (
        audio_track.strip()[:200]
        if isinstance(audio_track, str) and audio_track.strip()
        else None
    )

    try:
        payload = await build_waveform(
            url,
            duration=duration,
            origin=origin,
            force=bool(data.get("force")),
            client=getattr(request.app.state, "http", None),
            audio_url=audio_url,
            audio_track=audio_track,
            headers=sanitize_headers(data.get("headers")),
        )
    except WaveformError as exc:
        return JSONResponse({"success": False, "error": str(exc)}, status_code=exc.status_code)

    return JSONResponse(payload)


async def waveform_stream_endpoint(request):
    """Aynı çıkarımı NDJSON olayları halinde, hazır oldukça akıtır."""
    try:
        data = await request.json()
    except Exception:
        return JSONResponse(
            {"success": False, "error": t("error.invalidBody")},
            status_code=400,
        )

    url = str(data.get("url", "")).strip()
    if not url:
        return JSONResponse(
            {"success": False, "error": t("error.urlEmpty")},
            status_code=400,
        )

    try:
        duration = float(data.get("duration") or 0.0)
    except (TypeError, ValueError):
        duration = 0.0

    origin = data.get("origin")
    origin = origin.strip() if isinstance(origin, str) and origin.strip() else None

    audio_url = data.get("audio_url")
    audio_url = (
        audio_url.strip()
        if isinstance(audio_url, str) and audio_url.strip()
        else None
    )

    audio_track = data.get("audio_track")
    audio_track = (
        audio_track.strip()[:200]
        if isinstance(audio_track, str) and audio_track.strip()
        else None
    )

    async def events():
        async for event in stream_waveform(
            url,
            duration=duration,
            origin=origin,
            force=bool(data.get("force")),
            client=getattr(request.app.state, "http", None),
            audio_url=audio_url,
            audio_track=audio_track,
            headers=sanitize_headers(data.get("headers")),
        ):
            yield (
                json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n"
            ).encode("utf-8")

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


routes = [
    Route("/api/waveform", waveform_endpoint, methods=["POST"]),
    Route("/api/waveform/stream", waveform_stream_endpoint, methods=["POST"]),
]
