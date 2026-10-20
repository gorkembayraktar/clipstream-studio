"""Medya uç noktaları: kaynak çözümleme, analiz ve CORS proxy'si."""
from starlette.responses import JSONResponse
from starlette.routing import Route

from services.header_store import register_headers
from services.prober import ProbeError, probe_url
from services.proxy import proxy_request
from services.request_headers import sanitize_headers
from services.resolver import ResolveError, resolve_url


async def resolve_endpoint(request):
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": "Geçersiz istek gövdesi."}, status_code=400)

    url = str(data.get("url", "")).strip()
    if not url:
        return JSONResponse({"success": False, "error": "URL boş bırakılamaz."}, status_code=400)

    # curl ile yapıştırılan başlıklar (doğrudan medya kaynakları için).
    headers = sanitize_headers(data.get("headers"))

    try:
        result = await resolve_url(url, getattr(request.app.state, "http", None), headers)
    except ResolveError as exc:
        return JSONResponse(
            {
                "success": False,
                "is_ytdlp_missing": exc.ytdlp_missing,
                "error": str(exc),
            },
            status_code=exc.status_code,
        )

    # Başlıklar URL'ye yazılmaz: oynatma proxy'si kısa ömürlü belirteçle kullanır.
    if result.get("platform") == "direct":
        result["header_token"] = register_headers(headers)
    return JSONResponse(result)


async def probe_endpoint(request):
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": "Geçersiz istek gövdesi."}, status_code=400)

    url = str(data.get("url", "")).strip()
    if not url:
        return JSONResponse({"success": False, "error": "URL boş bırakılamaz."}, status_code=400)

    try:
        return JSONResponse(await probe_url(url, sanitize_headers(data.get("headers"))))
    except ProbeError as exc:
        return JSONResponse({"success": False, "error": str(exc)}, status_code=exc.status_code)


async def proxy_endpoint(request):
    return await proxy_request(request)


routes = [
    Route("/api/media/resolve", resolve_endpoint, methods=["POST"]),
    Route("/api/media/probe", probe_endpoint, methods=["POST"]),
    Route("/api/media/proxy", proxy_endpoint, methods=["GET"]),
]
