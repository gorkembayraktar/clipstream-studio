"""Dışa aktarma işleri: oluşturma, durum sorgulama, iptal."""
import asyncio

from starlette.responses import JSONResponse
from starlette.routing import Route

from core.i18n import current_language, t
from services.exporter import run_export_job


async def create_job_endpoint(request):
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": t("error.invalidBody")}, status_code=400)

    if not str(payload.get("url", "")).strip():
        return JSONResponse({"success": False, "error": t("error.sourceRequired")}, status_code=400)

    manager = request.app.state.jobs
    job = manager.create(payload, lang=current_language())
    asyncio.create_task(run_export_job(job, manager, request.app.state.http))
    return JSONResponse({"success": True, "job_id": job["id"]})


async def job_status_endpoint(request):
    manager = request.app.state.jobs
    job = manager.get(request.path_params["job_id"])
    if job is None:
        return JSONResponse({"error": t("error.jobNotFound")}, status_code=404)
    return JSONResponse(manager.public_view(job))


async def cancel_job_endpoint(request):
    manager = request.app.state.jobs
    job = manager.get(request.path_params["job_id"])
    if job is None:
        return JSONResponse({"error": t("error.jobNotFound")}, status_code=404)
    success, message = manager.cancel(job)
    return JSONResponse({"success": success, "message": message})


routes = [
    Route("/api/jobs", create_job_endpoint, methods=["POST"]),
    Route("/api/jobs/{job_id}", job_status_endpoint, methods=["GET"]),
    Route("/api/jobs/{job_id}/cancel", cancel_job_endpoint, methods=["POST"]),
]
