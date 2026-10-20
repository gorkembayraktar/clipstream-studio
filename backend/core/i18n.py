"""İstek diline göre İngilizce/Türkçe kullanıcı mesajları.

Arayüz, her API isteğinde `Accept-Language` başlığını gönderir. Bu modül
başlığı bir `ContextVar` içinde tutar; böylece servisler mesaj üretirken dili
açıkça parametre olarak taşımak zorunda kalmaz. Arka planda başlatılan dışa
aktarma işleri de oluşturuldukları andaki dili devralır.
"""
from contextvars import ContextVar
from typing import Any, Literal

Lang = Literal["en", "tr"]
DEFAULT_LANG: Lang = "en"

_current_language: ContextVar[Lang] = ContextVar("clipstream_language", default=DEFAULT_LANG)

#: Anahtar → (İngilizce, Türkçe). İngilizce varsayılan/öncelikli dildir.
_MESSAGES: dict[str, tuple[str, str]] = {
    # --------------------------------------------------------------- genel
    "error.notFound": ("Not found.", "Bulunamadı."),
    "error.invalidBody": ("Invalid request body.", "Geçersiz istek gövdesi."),
    "error.urlEmpty": ("URL cannot be empty.", "URL boş bırakılamaz."),
    "error.sourceRequired": ("Source URL is required.", "Kaynak adresi zorunludur."),
    "error.sourceEmpty": ("Source URL is empty.", "Kaynak adresi boş."),
    "error.invalidRange": ("Invalid time range.", "Geçersiz zaman aralığı."),
    "error.endAfterStart": (
        "End time must be greater than start time.",
        "Bitiş zamanı, başlangıç zamanından büyük olmalıdır.",
    ),
    "error.jobNotFound": ("Job not found.", "İşlem bulunamadı."),
    "error.jobFinished": ("Job has already finished.", "İşlem zaten sonlandı."),
    "error.jobCancelled": ("Export cancelled.", "Dışa aktarma iptal edildi."),
    "error.ffmpegExportFailed": (
        "FFmpeg export failed.",
        "FFmpeg dışa aktarımı başarısız oldu.",
    ),
    "error.proxyMissingUrl": ("Missing 'url' parameter.", "Eksik 'url' parametresi."),
    "error.proxyFailed": (
        "Proxy request failed: {detail}",
        "Proxy isteği başarısız: {detail}",
    ),
    # ------------------------------------------------------- yerel dosyalar
    "error.fileNameRequired": ("File name was not provided.", "Dosya adı belirtilmedi."),
    "error.unsupportedFileType": (
        "This file type is not supported. Choose a video (.mp4, .webm, .mov, .mkv, .avi...).",
        "Bu dosya türü desteklenmiyor. Video seçin (.mp4, .webm, .mov, .mkv, .avi...).",
    ),
    "error.fileTooLarge": (
        "File is too large (limit {limit_gb} GB).",
        "Dosya çok büyük (üst sınır {limit_gb} GB).",
    ),
    "error.fileSaveFailed": (
        "Could not save the file (is there enough disk space?).",
        "Dosya kaydedilemedi (disk alanı yeterli mi?).",
    ),
    "error.emptyUpload": ("An empty file was uploaded.", "Boş dosya yüklendi."),
    "error.filePrepareFailed": (
        "Could not prepare the file: {detail}",
        "Dosya hazırlanamadı: {detail}",
    ),
    "error.localFileNotFound": (
        "File not found. If the server was restarted, select the file again.",
        "Dosya bulunamadı. Sunucu yeniden başlatıldıysa dosyayı yeniden seçin.",
    ),
    "error.fileNotFound": ("File not found.", "Dosya bulunamadı."),
    "error.fileEmpty": ("The file is empty.", "Dosya boş."),
    "error.fileAccessFailed": (
        "Could not access the file: {detail}",
        "Dosyaya erişilemedi: {detail}",
    ),
    "error.fileAnalyzeFailed": (
        "Could not analyze the file: {detail}",
        "Dosya analiz edilemedi: {detail}",
    ),
    "error.noPlayableVideo": (
        "No playable video stream was found in this file.",
        "Bu dosyada oynatılabilir bir video akışı bulunamadı.",
    ),
    "error.unsupportedCodec": (
        "The video codec in this file ({codec}) cannot be played in the browser. "
        "Convert the file to H.264 (MP4) and try again.",
        "Bu dosyanın video kodeği ({codec}) tarayıcıda oynatılamıyor. "
        "Dosyayı H.264 (MP4) biçimine dönüştürüp tekrar deneyin.",
    ),
    "error.remuxTimeout": (
        "Timed out while converting the file to a browser-compatible format.",
        "Dosya tarayıcı biçimine dönüştürülürken zaman aşımına uğradı.",
    ),
    "error.remuxCancelled": ("File preparation was cancelled.", "Dosya hazırlığı iptal edildi."),
    "error.remuxFailed": (
        "Could not convert the file to a browser-compatible format. {detail}",
        "Dosya tarayıcı biçimine dönüştürülemedi. {detail}",
    ),
    "error.remuxUnknown": (
        "FFmpeg reported an unknown error.",
        "FFmpeg bilinmeyen bir hata verdi.",
    ),
    "error.cancelled": ("Operation cancelled.", "İşlem iptal edildi."),
    # -------------------------------------------------------- dosya penceresi
    "error.windowsOnly": (
        "This feature is supported only on Windows.",
        "Bu özellik yalnızca Windows'ta destekleniyor.",
    ),
    "error.pickWindowsOnly": (
        "The local file picker is available only on Windows.",
        "Yerel dosya seçim penceresi yalnızca Windows'ta kullanılabilir.",
    ),
    "error.pickAlreadyOpen": (
        "A file picker is already open.",
        "Zaten açık bir dosya seçim penceresi var.",
    ),
    "error.pickOpenFailed": (
        "Could not open the file picker: {detail}",
        "Dosya seçim penceresi açılamadı: {detail}",
    ),
    "error.pickExitCode": ("exit code {code}", "çıkış kodu {code}"),
    "dialog.title": ("Select video — ClipStream Studio", "Video seç — ClipStream Studio"),
    "dialog.videoFiles": ("Video files", "Video dosyaları"),
    "dialog.allFiles": ("All files", "Tüm dosyalar"),
    # ---------------------------------------------------------- galeri
    "error.invalidFileName": ("Invalid file name.", "Geçersiz dosya adı."),
    "error.deleteFailed": ("Could not delete the file: {detail}", "Dosya silinemedi: {detail}"),
    "message.fileDeleted": ("File deleted.", "Dosya silindi."),
    "message.revealSelected": ("{name} selected in Explorer.", "{name} gezginde seçildi."),
    "message.exportsOpened": ("exports folder opened.", "exports klasörü açıldı."),
    # --------------------------------------------------------- yt-dlp
    "error.ytdlpMissing": (
        "yt-dlp was not found on this system. To install it: pip install -U yt-dlp",
        "Sistemde yt-dlp bulunamadı. Kurmak için: pip install -U yt-dlp",
    ),
    "error.ytdlpTimeout": (
        "yt-dlp timed out while resolving the link.",
        "yt-dlp bağlantıyı çözümlerken zaman aşımına uğradı.",
    ),
    "error.instagramLogin": (
        "Instagram is not sharing this post without a login. The app intentionally "
        "does not use cookies for account safety; only public posts can be resolved.",
        "Instagram bu gönderiyi oturum açmadan paylaşmıyor. Uygulama hesap "
        "güvenliği için bilinçli olarak çerez kullanmıyor; yalnızca herkese "
        "açık gönderiler çözülebilir.",
    ),
    "error.ytdlpNoInfo": (
        "yt-dlp could not retrieve video information.",
        "yt-dlp video bilgilerini alamadı.",
    ),
    "error.noPlayableStream": (
        "No playable video stream was found.",
        "Oynatılabilir bir video akışı bulunamadı.",
    ),
    "label.source": ("Source", "Kaynak"),
    # --------------------------------------------------------- ffprobe
    "error.probeTimeout": (
        "ffprobe analysis timed out (the remote server may not be responding).",
        "ffprobe analizi zaman aşımına uğradı (uzak sunucu yanıt vermiyor olabilir).",
    ),
    "error.probeFailed": (
        "ffprobe could not complete the video analysis.",
        "ffprobe video analizini tamamlayamadı.",
    ),
    # -------------------------------------------------------- dalga formu
    "error.waveformNoAudio": (
        "No audio stream was found or it could not be resolved.",
        "Ses akışı bulunamadı ya da çözümlenemedi.",
    ),
    "error.waveformTimeout": (
        "Waveform extraction timed out (the source may be slow).",
        "Dalga formu çıkarımı zaman aşımına uğradı (kaynak yavaş olabilir).",
    ),
    "error.waveformNoStream": ("The source has no audio stream.", "Kaynakta ses akışı yok."),
    "error.waveformFailed": (
        "FFmpeg could not extract the waveform.",
        "FFmpeg dalga formu çıkaramadı.",
    ),
    # ------------------------------------------------------------- kare
    "error.frameQueueFull": (
        "The frame request queue is full. Try again shortly.",
        "Kare isteği kuyruğu dolu, biraz sonra tekrar deneyin.",
    ),
    "error.frameTimeout": ("Frame extraction timed out.", "Kare çıkarımı zaman aşımına uğradı."),
    "error.frameFailed": ("Could not extract the frame.", "Kare çıkarılamadı."),
    # ------------------------------------------------------ derlenmemiş arayüz
    "fallback.intro": (
        "The interface has not been built yet. You have two options:",
        "Arayüz henüz derlenmedi. İki seçeneğin var:",
    ),
    "fallback.production": (
        "Production mode — build with one command: "
        "<code>cd frontend &amp;&amp; npm run build</code>, then reload this page.",
        "Üretim modu — tek komutla derle: "
        "<code>cd frontend &amp;&amp; npm run build</code>, ardından bu sayfayı yenile.",
    ),
    "fallback.development": (
        "Development mode: start the backend and Vite dev server together with "
        "<code>scripts/dev.bat</code>, then open <code>http://127.0.0.1:5173</code>.",
        "Geliştirme modu: <code>scripts/dev.bat</code> ile backend + Vite dev "
        "sunucusunu birlikte başlat, ardından "
        "<code>http://127.0.0.1:5173</code> adresini aç.",
    ),
}


def normalize_language(value: str | None) -> Lang:
    """Dil kodunu desteklenen iki dilden birine indirger (varsayılan İngilizce)."""
    return "tr" if str(value or "").strip().lower().startswith("tr") else DEFAULT_LANG


def parse_accept_language(header: str | None) -> Lang:
    """`Accept-Language` başlığındaki ilk desteklenen dili seçer."""
    for part in str(header or "").split(","):
        token = part.split(";", 1)[0].strip().lower()
        if token.startswith("tr"):
            return "tr"
        if token.startswith("en"):
            return "en"
    return DEFAULT_LANG


def current_language() -> Lang:
    return _current_language.get()


def set_language(language: str | None) -> None:
    _current_language.set(normalize_language(language))


def translate(language: Lang, key: str, **params: Any) -> str:
    """Anahtarı verilen dilde biçimlendirir; bilinmeyen anahtar olduğu gibi döner."""
    entry = _MESSAGES.get(key)
    if entry is None:
        return key
    template = entry[1] if language == "tr" else entry[0]
    try:
        return template.format(**params)
    except (KeyError, IndexError, ValueError):
        return template


def t(key: str, **params: Any) -> str:
    """Geçerli istek dilinde çevrilmiş mesaj."""
    return translate(current_language(), key, **params)


class LanguageMiddleware:
    """Her HTTP isteği için dili ContextVar'a yazar, istek bitince geri alır."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        header = ""
        for name, value in scope.get("headers", []):
            if name.lower() == b"accept-language":
                header = value.decode("latin-1")
                break

        token = _current_language.set(parse_accept_language(header))
        try:
            await self.app(scope, receive, send)
        finally:
            _current_language.reset(token)
