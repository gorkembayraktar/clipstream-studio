"""Galeri uç noktaları: listeleme, silme, gezginde gösterme."""
from starlette.responses import JSONResponse
from starlette.routing import Route

from core.i18n import t
from services.library import LibraryError, delete_file, list_files, reveal_in_explorer


async def list_files_endpoint(request):
    return JSONResponse({"files": list_files()})


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
    Route("/api/library/{filename}", delete_file_endpoint, methods=["DELETE"]),
]
