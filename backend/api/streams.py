"""Proje akışı uç noktaları: özet + HLS playlist + segmentler.

Tarayıcı playlist'i doğrudan hls.js ile oynatır; segment adresleri playlist'e
göre görecelidir. ffmpeg/ffprobe/dalga formu aynı playlist'i yerel dosya olarak
okur (bkz. `services.local_media.local_path`).
"""
from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Route

from core.i18n import t
from services import streams


def _error(message: str, status_code: int = 400) -> JSONResponse:
    return JSONResponse({"success": False, "error": message}, status_code=status_code)


async def summary_endpoint(request):
    stream_id = str(request.path_params.get("stream_id") or "")
    payload = streams.summary(stream_id)
    if payload is None:
        return _error(t("error.streamNotFound"), 404)
    return JSONResponse(payload)


async def playlist_endpoint(request):
    stream_id = str(request.path_params.get("stream_id") or "")
    path = streams.segment_path(stream_id, streams.PLAYLIST_FILE)
    if path is None or not path.is_file():
        return _error(t("error.streamNotFound"), 404)
    return FileResponse(
        path,
        media_type="application/vnd.apple.mpegurl",
        headers={"Cache-Control": "no-store"},
    )


async def segment_endpoint(request):
    stream_id = str(request.path_params.get("stream_id") or "")
    file_name = str(request.path_params.get("file_name") or "")
    path = streams.segment_path(stream_id, file_name)
    if path is None or not path.is_file():
        return _error(t("error.streamNotFound"), 404)
    return FileResponse(
        path,
        media_type="video/mp2t",
        headers={"Cache-Control": "no-store"},
    )


async def delete_recording_endpoint(request):
    """Akıştaki bir kaydı (bloğu) siler: süren kayıt önce bırakılır."""
    stream_id = str(request.path_params.get("stream_id") or "")
    recording_id = str(request.path_params.get("recording_id") or "")
    recorder = getattr(request.app.state, "recorder", None)
    if recorder is not None:
        await recorder.abandon(stream_id, recording_id)
    try:
        payload = await streams.remove_recording(stream_id, recording_id)
    except streams.StreamError as exc:
        return _error(str(exc), exc.status_code)
    return JSONResponse(payload)


routes = [
    Route("/api/streams/{stream_id}", summary_endpoint, methods=["GET"]),
    Route("/api/streams/{stream_id}/index.m3u8", playlist_endpoint, methods=["GET"]),
    Route(
        "/api/streams/{stream_id}/recordings/{recording_id}",
        delete_recording_endpoint,
        methods=["DELETE"],
    ),
    Route("/api/streams/{stream_id}/{file_name}", segment_endpoint, methods=["GET"]),
]
