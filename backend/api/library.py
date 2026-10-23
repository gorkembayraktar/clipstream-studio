"""Galeri uç noktaları: listeleme, silme, gezginde gösterme."""
from starlette.responses import JSONResponse
from starlette.routing import Route

from core.i18n import t
from services.library import (
    LibraryError,
    delete_file,
    get_file_meta,
    list_files,
    reveal_in_explorer,
)
from services.prober import ProbeError


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
    Route("/api/library/{filename}", delete_file_endpoint, methods=["DELETE"]),
]
