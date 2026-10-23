"""Zaman çizelgesi storyboard uç noktaları.

İstek gövdesi:
    {"url": "<oynatılan akış>", "origin": "<master m3u8 (varsa)>",
     "duration": 634.5, "identity": "<yerel dosya kimliği (varsa)>",
     "batch": 0}

`POST /api/storyboard` istenen 10 karelik grubu hazırlar (önbellekte varsa
hemen döner). İstemci grupları sırayla ister; ilk grup tüm süreye dağıtılır.
`GET /api/storyboard/<özet>.jpg` hazır sprite'ı uzun ömürlü önbellekle servis eder.
"""
import asyncio
from contextlib import suppress

from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Route

from core.i18n import t
from services.request_headers import sanitize_headers
from services.storyboard import StoryboardError, build_storyboard, sheet_path


async def storyboard_endpoint(request):
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": t("error.invalidBody")}, status_code=400)

    url = str(data.get("url", "")).strip()
    if not url:
        return JSONResponse({"success": False, "error": t("error.urlEmpty")}, status_code=400)

    origin = data.get("origin")
    origin = origin.strip() if isinstance(origin, str) and origin.strip() else None
    identity = data.get("identity")
    identity = identity.strip()[:2048] if isinstance(identity, str) and identity.strip() else None

    try:
        duration = float(data.get("duration") or 0.0)
    except (TypeError, ValueError):
        duration = 0.0

    try:
        batch = int(data.get("batch") or 0)
    except (TypeError, ValueError):
        batch = 0

    try:
        task = asyncio.create_task(
            build_storyboard(
                url,
                duration,
                batch=batch,
                origin=origin,
                client=getattr(request.app.state, "http", None),
                headers=sanitize_headers(data.get("headers")),
                identity=identity,
            )
        )
        while True:
            done, _ = await asyncio.wait({task}, timeout=0.5)
            if task in done:
                payload = task.result()
                break
            try:
                disconnected = await request.is_disconnected()
            except Exception:
                disconnected = False
            if disconnected:
                # Kaynak değişti / sekme kapandı: FFmpeg süreçlerini durdur.
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
                return JSONResponse(
                    {"success": False, "error": t("error.storyboardFailed")},
                    status_code=499,
                )
    except StoryboardError as exc:
        return JSONResponse(
            {"success": False, "error": str(exc)}, status_code=exc.status_code
        )

    return JSONResponse(payload)


async def storyboard_sheet_endpoint(request):
    key = str(request.path_params.get("key", ""))
    path = sheet_path(key)
    if path is None:
        return JSONResponse(
            {"success": False, "error": t("error.storyboardNotFound")},
            status_code=404,
        )
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


routes = [
    Route("/api/storyboard", storyboard_endpoint, methods=["POST"]),
    Route("/api/storyboard/{key}.jpg", storyboard_sheet_endpoint, methods=["GET"]),
]
