"""Uygulama genel yapılandırması ve sabitler."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent        # backend/
PROJECT_ROOT = BASE_DIR.parent                    # clip2/
EXPORTS_DIR = PROJECT_ROOT / "exports"
CACHE_DIR = PROJECT_ROOT / "cache"
#: Canlı yayın kayıtları: yalnızca süren/duraklatılmış kaydın durum dosyası.
#: Segmentler doğrudan proje akışına yazılır (bkz. `STREAMS_DIR`).
RECORDINGS_DIR = CACHE_DIR / "recordings"
#: Proje akışı: kayıtların ard arda eklendiği tek HLS akışı.
#: Klasör adı proje kimliğidir; segmentler + `index.m3u8` burada durur.
STREAMS_DIR = CACHE_DIR / "streams"
STREAMS_ROUTE = "/api/streams"
#: Güvenlik sınırları: aşıldığında kayıt kendiliğinden durur (disk şişmesin).
RECORDINGS_MAX_SECONDS = 6 * 3600
RECORDINGS_MAX_BYTES = 16 * 1024 ** 3
WAVEFORM_CACHE_DIR = CACHE_DIR / "waveform"
WAVEFORM_TEMP_DIR = CACHE_DIR / "waveform-tmp"
STORYBOARD_CACHE_DIR = CACHE_DIR / "storyboard"
STORYBOARD_TEMP_DIR = CACHE_DIR / "storyboard-tmp"
THUMBNAIL_CACHE_DIR = CACHE_DIR / "thumbnails"
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"

#: Dinleme adresi. `CLIPSTREAM_PORT` ile ikinci bir kopya (test) ayrı portta
#: çalıştırılabilir; üretilen dosya adresleri de bu portu kullanır.
HOST = os.environ.get("CLIPSTREAM_HOST", "127.0.0.1")
PORT = int(os.environ.get("CLIPSTREAM_PORT", "8765"))

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
WAVEFORM_TEMP_DIR.mkdir(parents=True, exist_ok=True)
STORYBOARD_CACHE_DIR.mkdir(parents=True, exist_ok=True)
STORYBOARD_TEMP_DIR.mkdir(parents=True, exist_ok=True)
THUMBNAIL_CACHE_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
STREAMS_DIR.mkdir(parents=True, exist_ok=True)
