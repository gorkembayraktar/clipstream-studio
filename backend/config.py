"""Uygulama genel yapılandırması ve sabitler."""
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent        # backend/
PROJECT_ROOT = BASE_DIR.parent                    # clip2/
EXPORTS_DIR = PROJECT_ROOT / "exports"
CACHE_DIR = PROJECT_ROOT / "cache"
WAVEFORM_CACHE_DIR = CACHE_DIR / "waveform"
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"

HOST = "127.0.0.1"
PORT = 8765

# Yerel dosya kaynakları: tarayıcıdan yüklenen videolar burada (geçici) saklanır.
# Oynatma adresi `/uploads/<dosya>`; ffmpeg/ffprobe aynı dosyayı doğrudan okur.
UPLOADS_DIR = CACHE_DIR / "uploads"
UPLOADS_ROUTE = "/uploads"
UPLOADS_MAX_AGE_DAYS = 7
MAX_UPLOAD_BYTES = 20 * 1024 ** 3  # 20 GB

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

VIDEO_EXTENSIONS = {".mp4", ".gif", ".mp3", ".webm", ".mkv"}
OUTPUT_FORMATS = {"mp4", "gif", "mp3"}

EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
WAVEFORM_CACHE_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
