"""ClipStream Studio — modüler backend giriş noktası.

Çalıştırma:
    python backend/app.py

Geliştirme modunda frontend ayrıca `npm run dev` ile (5173) çalışır ve
Vite, /api ile /exports isteklerini bu sunucuya (8765) proxy'ler.
Üretim modunda `npm run build` çıktısı (frontend/dist) bu sunucudan servis edilir.
"""
import sys
import threading
import time
import webbrowser
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import httpx
import uvicorn
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import FileResponse, HTMLResponse, JSONResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from api import capabilities as capabilities_api
from api import frames as frames_api
from api import jobs as jobs_api
from api import library as library_api
from api import local as local_api
from api import media as media_api
from api import storyboard as storyboard_api
from api import waveform as waveform_api
from config import (
    EXPORTS_DIR,
    FRONTEND_DIST,
    HOST,
    PORT,
    UPLOADS_DIR,
    UPLOADS_MAX_AGE_DAYS,
    USER_AGENT,
)
from core.i18n import LanguageMiddleware, current_language, t
from core.jobs import JobManager
from services.local_media import cleanup_uploads
from services.segment_downloader import cleanup_stale_temp_dirs
from services.storyboard import cleanup_storyboards


def _fallback_html() -> str:
    lang = current_language()
    return f"""<!doctype html>
<html lang="{lang}">
<head>
  <meta charset="utf-8">
  <title>ClipStream Studio</title>
  <style>
    body {{ background:#09090b; color:#fafafa; font-family:system-ui,sans-serif;
           display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }}
    main {{ max-width:560px; padding:32px; border:1px solid #27272a; border-radius:12px; }}
    code {{ background:#18181b; padding:2px 8px; border-radius:6px; color:#a5b4fc; }}
    li {{ margin:8px 0; }}
  </style>
</head>
<body>
<main>
  <h1>🎬 ClipStream Studio</h1>
  <p>{t("fallback.intro")}</p>
  <ol>
    <li>{t("fallback.production")}</li>
    <li>{t("fallback.development")}</li>
  </ol>
</main>
</body>
</html>"""


async def index_fallback(request):
    return HTMLResponse(_fallback_html(), headers={"Cache-Control": "no-cache"})



def _spa_response() -> FileResponse:
    """SPA giriş sayfası: hash'li varlık adları her derlemede değiştiği için
    index.html asla önbelleğe alınmaz (aksi halde eski arayüz yüklenir)."""
    return FileResponse(
        FRONTEND_DIST / "index.html",
        headers={"Cache-Control": "no-cache"},
    )


async def spa_index(request):
    return _spa_response()


async def spa_fallback(request):
    """Bilinmeyen yollar: API/dışa aktarma ise 404, değilse arayüze düş."""
    path = str(request.path_params.get("path", ""))
    if path.startswith(("api/", "exports/", "uploads/")):
        return JSONResponse({"success": False, "error": t("error.notFound")}, status_code=404)
    return _spa_response()


def create_app() -> Starlette:
    # Bir haftadan eski geçici yerel dosyalar açılışta temizlenir.
    cleanup_uploads(UPLOADS_MAX_AGE_DAYS)
    # Çökme sonrası kalan waveform indirme klasörleri de temizlenir.
    cleanup_stale_temp_dirs()
    # Süresi geçen / fazla storyboard dosyaları açılışta temizlenir.
    cleanup_storyboards()

    routes = [
        *media_api.routes,
        *local_api.routes,
        *capabilities_api.routes,
        *jobs_api.routes,
        *library_api.routes,
        *waveform_api.routes,
        *storyboard_api.routes,
        *frames_api.routes,
    ]

    routes.append(Mount("/exports", app=StaticFiles(directory=str(EXPORTS_DIR)), name="exports"))
    # Yerel dosya kaynakları: Range destekli servis (video arama/sarma çalışır).
    routes.append(Mount("/uploads", app=StaticFiles(directory=str(UPLOADS_DIR)), name="uploads"))

    if (FRONTEND_DIST / "index.html").exists():
        routes.append(Route("/", spa_index, methods=["GET"]))
        routes.append(Mount("/", app=StaticFiles(directory=str(FRONTEND_DIST)), name="spa"))
        routes.append(Route("/{path:path}", spa_fallback, methods=["GET"]))
    else:
        routes.append(Route("/", index_fallback, methods=["GET"]))

    app = Starlette(
        debug=True,
        routes=routes,
        middleware=[
            Middleware(LanguageMiddleware),
            Middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]),
        ],
    )

    app.state.jobs = JobManager()
    app.state.user_agent = USER_AGENT
    app.state.http = httpx.AsyncClient(
        verify=False,
        timeout=httpx.Timeout(15.0, read=60.0),
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT, "Accept": "*/*"},
    )

    async def on_shutdown() -> None:
        await app.state.http.aclose()

    app.add_event_handler("shutdown", on_shutdown)
    return app


app = create_app()


def _open_browser() -> None:
    time.sleep(1.2)
    webbrowser.open(f"http://{HOST}:{PORT}")


def _configure_console() -> None:
    """Türkçe Windows konsolları (cp1254 vb.) emoji/UTF-8'de çökmesin."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(errors="replace")
        except Exception:
            pass


def main() -> None:
    _configure_console()
    print("=" * 62)
    print(" 🎬 ClipStream Studio — Video & Stream Clipper")
    print(f" 🌐 Web arayüzü       : http://{HOST}:{PORT}")
    print(f" 📁 Dışa aktarılanlar : {EXPORTS_DIR}")
    if not (FRONTEND_DIST / "index.html").exists():
        print(" ⚠  frontend/dist bulunamadı — arayüz için:")
        print("    cd frontend && npm run build   (veya scripts\\dev.bat ile geliştirme modu)")
    print("=" * 62)

    threading.Thread(target=_open_browser, daemon=True).start()
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    main()
