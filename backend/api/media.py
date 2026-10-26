"""Medya uç noktaları: kaynak çözümleme, analiz ve CORS proxy'si."""
import asyncio
import json

from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

from core.i18n import t
from services.header_store import get_headers, register_headers
from services.prober import ProbeError, probe_url
from services.proxy import proxy_request
from services.request_headers import sanitize_headers
from services.resolver import ResolveCancelled, ResolveError, resolve_url
from services.subtitles import SubtitleError, build_webvtt


async def resolve_stream_endpoint(request):
    """Çözümleme ve indirme ilerlemesini NDJSON akışı olarak iletir; iptal desteği sağlar."""
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": t("error.invalidBody")}, status_code=400)

    url = str(data.get("url", "")).strip()
    if not url:
        return JSONResponse({"success": False, "error": t("error.urlEmpty")}, status_code=400)

    headers = sanitize_headers(data.get("headers"))

    async def events():
        queue: asyncio.Queue = asyncio.Queue()

        async def _progress(percent: float, stage: str, detail: str = ""):
            await queue.put({
                "type": "progress",
                "percent": round(percent, 1),
                "stage": stage,
                "detail": detail,
            })

        async def _resolve_task():
            try:
                result = await resolve_url(
                    url,
                    getattr(request.app.state, "http", None),
                    headers,
                    on_progress=_progress,
                )
                if result.get("platform") in {"direct", "tiktok", "ytdlp"}:
                    extra_headers = result.pop("http_headers", None) or {}
                    proxy_headers = {**extra_headers, **headers}
                    result["header_token"] = (
                        register_headers(proxy_headers) if proxy_headers else None
                    )
                await queue.put({"type": "done", "result": result})
            except ResolveCancelled:
                await queue.put({"type": "cancelled"})
            except ResolveError as exc:
                await queue.put({
                    "type": "error",
                    "error": str(exc),
                    "is_ytdlp_missing": exc.ytdlp_missing,
                    "status_code": exc.status_code,
                })
            except Exception as exc:
                await queue.put({"type": "error", "error": str(exc), "status_code": 500})

        task = asyncio.create_task(_resolve_task())

        try:
            while True:
                item = await queue.get()
                yield (json.dumps(item, ensure_ascii=False) + "\n").encode("utf-8")
                if item["type"] in {"done", "error", "cancelled"}:
                    break
        except (asyncio.CancelledError, GeneratorExit):
            task.cancel()
            raise
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


async def resolve_endpoint(request):
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": t("error.invalidBody")}, status_code=400)

    url = str(data.get("url", "")).strip()
    if not url:
        return JSONResponse({"success": False, "error": t("error.urlEmpty")}, status_code=400)

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
    if result.get("platform") in {"direct", "tiktok", "ytdlp"}:
        extra_headers = result.pop("http_headers", None) or {}
        proxy_headers = {**extra_headers, **headers}
        result["header_token"] = register_headers(proxy_headers) if proxy_headers else None
    return JSONResponse(result)


async def probe_endpoint(request):
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": t("error.invalidBody")}, status_code=400)

    url = str(data.get("url", "")).strip()
    if not url:
        return JSONResponse({"success": False, "error": t("error.urlEmpty")}, status_code=400)

    # header_token: TikTok/direct kaynaklarda resolve sonrası dönen Referer gibi CDN
    # başlıklarını ffprobe'a iletmek için kullanılır. Kullanıcının curl başlıkları ise
    # "headers" alanından gelir; token başlıkları bunların üzerine yazılmaz, birleştirilir.
    token_headers = get_headers(data.get("header_token"))
    user_headers = sanitize_headers(data.get("headers"))
    effective_headers = {**token_headers, **user_headers} or None

    try:
        return JSONResponse(await probe_url(url, effective_headers))
    except ProbeError as exc:
        return JSONResponse({"success": False, "error": str(exc)}, status_code=exc.status_code)


async def subtitles_endpoint(request):
    """HLS altyazı playlist'ini tek bir WebVTT metnine dönüştürür."""
    try:
        data = await request.json()
    except Exception:
        return JSONResponse(
            {"success": False, "error": t("error.invalidBody")}, status_code=400
        )

    url = str(data.get("url", "")).strip()
    if not url:
        return JSONResponse(
            {"success": False, "error": t("error.urlEmpty")}, status_code=400
        )

    try:
        vtt = await build_webvtt(
            getattr(request.app.state, "http", None),
            url,
            sanitize_headers(data.get("headers")),
        )
    except SubtitleError as exc:
        return JSONResponse(
            {"success": False, "error": str(exc)}, status_code=exc.status_code
        )

    return JSONResponse({"success": True, "vtt": vtt})


async def proxy_endpoint(request):
    return await proxy_request(request)


routes = [
    Route("/api/media/resolve", resolve_endpoint, methods=["POST"]),
    Route("/api/media/resolve/stream", resolve_stream_endpoint, methods=["POST"]),
    Route("/api/media/probe", probe_endpoint, methods=["POST"]),
    Route("/api/media/subtitles", subtitles_endpoint, methods=["POST"]),
    Route("/api/media/proxy", proxy_endpoint, methods=["GET"]),
]
