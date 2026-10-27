"""Canlı yayın kaydı uç noktaları: başlat, durdur, devam et, listele, sil.

Kayıtlar backend'de sürer; tarayıcı kapansa/F5 yense de durmaz. Arayüz
`GET /api/recordings` ile yalnızca **süren** kayıtları yoklar; biten kayıtlar
proje akışının bloklarıdır (bkz. `api/streams.py`).
"""
from starlette.responses import JSONResponse
from starlette.routing import Route

from services.recorder import RecordingError


def _error(message: str, status_code: int = 400) -> JSONResponse:
    return JSONResponse({"success": False, "error": message}, status_code=status_code)


def _recorder(request):
    return request.app.state.recorder


async def list_endpoint(request):
    return JSONResponse({"recordings": _recorder(request).list()})


async def start_endpoint(request):
    try:
        payload = await request.json()
    except Exception:
        return _error("Invalid request body.", 400)
    if not isinstance(payload, dict):
        return _error("Invalid request body.", 400)

    try:
        record = await _recorder(request).start(payload)
    except RecordingError as exc:
        return _error(str(exc), exc.status_code)
    return JSONResponse(record)


async def detail_endpoint(request):
    try:
        return JSONResponse(_recorder(request).get(request.path_params["record_id"]))
    except RecordingError as exc:
        return _error(str(exc), exc.status_code)


async def stop_endpoint(request):
    try:
        record = await _recorder(request).stop(request.path_params["record_id"])
    except RecordingError as exc:
        return _error(str(exc), exc.status_code)
    # Kayıt zaten bitmişse düğmeye ikinci kez basmak hata üretmez.
    return JSONResponse(record or {"success": True, "stopped": True})


async def pause_endpoint(request):
    try:
        record = await _recorder(request).pause(request.path_params["record_id"])
    except RecordingError as exc:
        return _error(str(exc), exc.status_code)
    return JSONResponse(record)


async def resume_endpoint(request):
    try:
        record = await _recorder(request).resume(request.path_params["record_id"])
    except RecordingError as exc:
        return _error(str(exc), exc.status_code)
    return JSONResponse(record)


async def delete_endpoint(request):
    try:
        await _recorder(request).delete(request.path_params["record_id"])
    except RecordingError as exc:
        return _error(str(exc), exc.status_code)
    return JSONResponse({"success": True})
routes = [
    Route("/api/recordings", list_endpoint, methods=["GET"]),
    Route("/api/recordings", start_endpoint, methods=["POST"]),
    Route("/api/recordings/{record_id}", detail_endpoint, methods=["GET"]),
    Route("/api/recordings/{record_id}", delete_endpoint, methods=["DELETE"]),
    Route("/api/recordings/{record_id}/stop", stop_endpoint, methods=["POST"]),
    Route("/api/recordings/{record_id}/pause", pause_endpoint, methods=["POST"]),
    Route("/api/recordings/{record_id}/resume", resume_endpoint, methods=["POST"]),
]
