"""Bellek teşhisi: süreç RSS'i, GC sayaçları ve önbellek boyutları."""
from collections import Counter

from starlette.responses import JSONResponse
from starlette.routing import Route

from services.diagnostics import snapshot


async def memory_diagnostics_endpoint(request):
    """Bellek anlık görüntüsünü döndürür.

    `?collect=true` eklenirse bir kez `gc.collect()` çalışır; bu yalnızca
    teşhis içindir, süreli çöp toplama bilinçli olarak yok. `with_payload`
    sayısı, bitmiş işlerde istek gövdesinin gerçekten bırakıldığını gösterir.
    """
    manager = request.app.state.jobs
    collect = request.query_params.get("collect", "").lower() in {
        "1",
        "true",
        "yes",
    }
    jobs = manager.list_jobs()
    body = {
        "success": True,
        **snapshot(collect=collect),
        "jobs": {
            "total": len(jobs),
            "by_status": dict(
                Counter(job.get("status", "unknown") for job in jobs)
            ),
            "with_payload": sum(1 for job in jobs if "payload" in job),
        },
    }
    return JSONResponse(body)


routes = [
    Route("/api/diagnostics/memory", memory_diagnostics_endpoint, methods=["GET"]),
]
