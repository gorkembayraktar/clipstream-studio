"""Yerel dosya uç noktaları: kopyasız seçim, yükleme ve oynatma.

- `POST /api/local/pick` → Windows dosya penceresini açar, seçilen dosyayı
  **kopyalamadan** kaynak olarak hazırlar.
- `POST /api/local/upload?name=<dosya>` → gövde dosyanın kendisidir (ham
  `application/octet-stream`); sürükle-bırak ve tarayıcı seçicisi bu yolu kullanır.
- `GET /api/local/file/<jeton>` → kopyasız kaynağın Range destekli oynatma adresi.
"""
import asyncio
from pathlib import Path

from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Route

from config import MAX_UPLOAD_BYTES
from core.i18n import t
from services.file_dialog import (
    DialogAlreadyOpen,
    DialogUnavailable,
    cancel_dialog,
    choose_video_file,
)
from services.local_media import (
    VIDEO_EXTENSIONS,
    LocalFileCancelled,
    LocalFileError,
    cancel_remux,
    new_upload_path,
    prepare_local_source,
    prepare_picked_source,
    registered_file,
    safe_extension,
)


def _error(message: str, status_code: int = 400) -> JSONResponse:
    return JSONResponse({"success": False, "error": message}, status_code=status_code)


async def pick_endpoint(request):
    """Kopyasız kaynak: yerel dosya penceresi + analiz."""
    try:
        timeout_ms = int(request.query_params.get("timeout_ms") or 0)
    except (TypeError, ValueError):
        timeout_ms = 0

    try:
        chosen = await asyncio.to_thread(choose_video_file, timeout_ms)
    except DialogAlreadyOpen:
        return JSONResponse({"success": False, "already_open": True}, status_code=409)
    except DialogUnavailable as exc:
        return JSONResponse(
            {"success": False, "error": str(exc), "dialog_unavailable": True},
            status_code=501,
        )

    if not chosen:
        return JSONResponse({"success": False, "cancelled": True})

    try:
        return JSONResponse(await prepare_picked_source(Path(chosen)))
    except LocalFileCancelled:
        return JSONResponse({"success": False, "cancelled": True})
    except LocalFileError as exc:
        return _error(str(exc), exc.status_code)
    except Exception as exc:  # beklenmedik hata
        return _error(t("error.filePrepareFailed", detail=exc), 500)


async def cancel_endpoint(request):
    """Süren işlemi iptal eder: açık dosya penceresi ve/veya remux süreci."""
    dialog_closed = await asyncio.to_thread(cancel_dialog)
    remux_stopped = await cancel_remux()
    return JSONResponse(
        {
            "success": True,
            "dialog_closed": dialog_closed,
            "remux_stopped": remux_stopped,
        }
    )


async def upload_endpoint(request):
    """Kopyalı kaynak: gövde ham dosya içeriğidir."""
    original_name = str(request.query_params.get("name") or "").strip()
    if not original_name:
        return _error(t("error.fileNameRequired"))

    extension = safe_extension(original_name)
    if extension not in VIDEO_EXTENSIONS:
        return _error(
            t("error.unsupportedFileType"),
            status_code=415,
        )

    target = new_upload_path(original_name)
    received = 0
    limit_gb = MAX_UPLOAD_BYTES // (1024 ** 3)

    try:
        with target.open("wb") as handle:
            async for chunk in request.stream():
                if not chunk:
                    continue
                received += len(chunk)
                if received > MAX_UPLOAD_BYTES:
                    raise LocalFileError(t("error.fileTooLarge", limit_gb=limit_gb), 413)
                handle.write(chunk)
    except LocalFileError as exc:
        target.unlink(missing_ok=True)
        return _error(str(exc), exc.status_code)
    except Exception:
        target.unlink(missing_ok=True)
        return _error(t("error.fileSaveFailed"), 500)

    if received == 0:
        target.unlink(missing_ok=True)
        return _error(t("error.emptyUpload"))

    try:
        result = await prepare_local_source(target, original_name)
    except LocalFileCancelled:
        return JSONResponse({"success": False, "cancelled": True})
    except LocalFileError as exc:
        return _error(str(exc), exc.status_code)
    except Exception as exc:  # beklenmedik hata
        target.unlink(missing_ok=True)
        return _error(t("error.filePrepareFailed", detail=exc), 500)

    return JSONResponse(result)


async def file_endpoint(request):
    """Kopyasız kaynağın oynatma adresi (Range destekli)."""
    path = registered_file(str(request.path_params.get("token") or ""))
    if path is None:
        return _error(
            t("error.localFileNotFound"),
            status_code=404,
        )
    return FileResponse(path, headers={"Cache-Control": "no-store"})


routes = [
    Route("/api/local/pick", pick_endpoint, methods=["POST"]),
    Route("/api/local/cancel", cancel_endpoint, methods=["POST"]),
    Route("/api/local/upload", upload_endpoint, methods=["POST"]),
    Route("/api/local/file/{token}", file_endpoint, methods=["GET"]),
]
