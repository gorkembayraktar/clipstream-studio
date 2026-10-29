"""Dışa aktarma işleri: oluşturma, durum sorgulama, iptal."""
import asyncio

from starlette.responses import JSONResponse
from starlette.routing import Route

from core.i18n import current_language, t
from core.jobs import CANCELLED
from services.exporter import run_export_job


async def _run_in_lane(job, manager, client, semaphore) -> None:
    """İşi kendi kulvarının kuyruğunda bekletip sırası gelince çalıştırır."""
    async with semaphore:
        # Kuyrukta beklerken iptal edilen iş boşuna render başlatmasın.
        if job["status"] == CANCELLED:
            return
        await run_export_job(job, manager, client)


#: Süren iş görevleri. `asyncio` görevlere yalnızca zayıf referans tuttuğu
#: için referanssız bir görev çalışırken çöp toplanabilir; ayrıca kapanışta
#: bekleyebilmek için listeye ihtiyaç var.
_RUNNING_TASKS: set[asyncio.Task] = set()


def _track(task: asyncio.Task) -> None:
    """Görevi güçlü referansla izler; bitince kümeden düşer."""
    _RUNNING_TASKS.add(task)
    task.add_done_callback(_RUNNING_TASKS.discard)


async def shutdown_jobs() -> None:
    """Kapanışta süren dışa aktarma görevlerini iptal edip bekler."""
    tasks = list(_RUNNING_TASKS)
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def create_job_endpoint(request):
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": t("error.invalidBody")}, status_code=400)

    if not str(payload.get("url", "")).strip():
        return JSONResponse({"success": False, "error": t("error.sourceRequired")}, status_code=400)

    manager = request.app.state.jobs
    job = manager.create(payload, lang=current_language())
    lanes = request.app.state.job_lanes
    semaphore = lanes.get(job.get("lane", "cpu"), lanes["cpu"])
    _track(
        asyncio.create_task(
            _run_in_lane(job, manager, request.app.state.http, semaphore)
        )
    )
    return JSONResponse({"success": True, "job_id": job["id"]})


async def list_jobs_endpoint(request):
    """Bellekteki işleri döndürür; `?active=true` yalnızca sürenleri verir.

    Sayfa tam yenilendiğinde istemci bu uçla panoyu geri yükler.
    """
    manager = request.app.state.jobs
    active_only = request.query_params.get("active", "").lower() in {
        "1",
        "true",
        "yes",
    }
    jobs = manager.list_jobs(active_only=active_only)
    return JSONResponse(
        {
            "success": True,
            "jobs": [manager.public_view(job) for job in jobs],
        }
    )


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
    Route("/api/jobs", list_jobs_endpoint, methods=["GET"]),
    Route("/api/jobs", create_job_endpoint, methods=["POST"]),
    Route("/api/jobs/{job_id}", job_status_endpoint, methods=["GET"]),
    Route("/api/jobs/{job_id}/cancel", cancel_job_endpoint, methods=["POST"]),
]
