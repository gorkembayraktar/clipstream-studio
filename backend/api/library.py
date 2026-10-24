"""Galeri uç noktaları: listeleme, silme, gezginde gösterme ve thumbnail."""
import asyncio

from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Route

from core.i18n import t
from services.library import (
    LibraryError,
    delete_file,
    get_file_meta,
    list_files,
    resolve_file,
    reveal_in_explorer,
)
from services.prober import ProbeError
from services.thumbnails import ThumbnailError, get_thumbnail


async def list_files_endpoint(request):
    return JSONResponse({"files": list_files()})


async def file_meta_endpoint(request):
    try:
        return JSONResponse(await get_file_meta(request.path_params["filename"]))
    except LibraryError as exc:
        return JSONResponse({"success": False, "error": str(exc)}, status_code=404)
    except ProbeError as exc:
        return JSONResponse(
            {"success": False, "error": str(exc)},
            status_code=exc.status_code,
        )


async def file_thumbnail_endpoint(request):
    try:
        target = resolve_file(request.path_params["filename"])
        thumbnail = await asyncio.to_thread(get_thumbnail, target)
    except (LibraryError, ThumbnailError) as exc:
        return JSONResponse({"success": False, "error": str(exc)}, status_code=404)

    # Windows'ta mimetypes .webp/.jpg için text/plain dönebildiğinden türü
    # doğrudan belirle.
    media_type = "image/webp" if thumbnail.suffix.lower() == ".webp" else "image/jpeg"
    # URL sürüm parametresiyle çağrılır; içerik değişmedikçe tarayıcıda kalabilir.
    return FileResponse(
        thumbnail,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


async def delete_file_endpoint(request):
    try:
        delete_file(request.path_params["filename"])
        return JSONResponse({"success": True, "message": t("message.fileDeleted")})
    except LibraryError as exc:
        return JSONResponse({"success": False, "error": str(exc)}, status_code=404)


async def reveal_endpoint(request):
    try:
        data = await request.json()
    except Exception:
        data = {}

    try:
        message = reveal_in_explorer(data.get("filename"))
        return JSONResponse({"success": True, "message": message})
    except LibraryError as exc:
        return JSONResponse({"success": False, "error": str(exc)}, status_code=400)


routes = [
    Route("/api/library", list_files_endpoint, methods=["GET"]),
    Route("/api/library/reveal", reveal_endpoint, methods=["POST"]),
    Route("/api/library/{filename}/meta", file_meta_endpoint, methods=["GET"]),
    Route("/api/library/{filename}/thumbnail", file_thumbnail_endpoint, methods=["GET"]),
    Route("/api/library/{filename}", delete_file_endpoint, methods=["DELETE"]),
]
