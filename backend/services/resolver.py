"""yt-dlp ile YouTube / X (Twitter) / Instagram bağlantılarını oynatılabilir akışa çözer."""
import asyncio
import json
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from typing import Any, Callable, Optional

from core.i18n import t
from services.hls import HlsRequestError, detect_hls_result, list_variants

#: Varsayılan önizleme kalitesi üst sınırı: oynatma 1080p'de başlar (daha yüksek
#: varyantlar listede görünür ve kullanıcı Kaynak panelinden seçebilir).
MAX_PREVIEW_HEIGHT = 1080


def _variant(
    url: str,
    height: int,
    *,
    hls: bool,
    has_audio: Optional[bool],
    audio_url: Optional[str],
    audio_hls: bool = False,
    audio_tracks: Optional[list[dict[str, Any]]] = None,
    subtitle_tracks: Optional[list[dict[str, Any]]] = None,
    quality_height: Optional[int] = None,
) -> dict[str, Any]:
    """Arayüzdeki kalite listesi için tek bir oynatma varyantı.

    `height` gerçek piksel yüksekliğidir; `quality_height` ise listede gösterilen
    yayın kalitesidir. Kırpılmış akışlarda (1920x800) ikisi farklıdır.
    """
    height = int(height or 0)
    quality = int(quality_height or height or 0)
    return {
        "url": url,
        "height": height,
        "quality_height": quality,
        "label": f"{quality}p" if quality else t("label.source"),
        "hls": hls,
        "has_audio": has_audio,
        "audio_url": audio_url,
        # Aynı ses grubundaki alternatif diller/rendition'lar. Tek ses varsa da
        # boş liste döner; arayüz yalnızca birden fazla seçenekte gösterir.
        "audio_tracks": audio_tracks or [],
        # Master playlist'teki WebVTT altyazı rendition'ları.
        "subtitle_tracks": subtitle_tracks or [],
        # Ayrı ses akışı HLS ise tarayıcıda hls.js ile bağlanır.
        "audio_hls": audio_hls,
        "default": False,
    }


def _variant_quality(item: dict[str, Any]) -> int:
    """Varyantın kalite etiketi için kullanılacak yükseklik (1080 gibi)."""
    return int(item.get("quality_height") or item.get("height") or 0)


def _pick_default_height(
    variants: list[dict[str, Any]], max_height: int = MAX_PREVIEW_HEIGHT
) -> int:
    """Varsayılan varyant: `max_height`'ı aşmayan en yüksek kalite (yoksa en yüksek)."""
    capped = [item for item in variants if 0 < _variant_quality(item) <= max_height]
    return _variant_quality(capped[0] if capped else variants[0])


def _quality_height(fmt: dict[str, Any]) -> int:
    """Kalite ekseni: dikey videolarda da anlamlı olsun diye kısa kenar kullanılır.

    X/Twitter videolarının çoğu dikey (ör. 576x1024); YouTube'da da Shorts
    1080x1920 gelir. Kısa kenar sayesinde "1080p" sınırı doğru uygulanır.
    """
    width = int(fmt.get("width") or 0)
    height = int(fmt.get("height") or 0)
    if not width or not height:
        match = re.match(r"^\s*(\d+)\s*x\s*(\d+)", str(fmt.get("resolution") or ""))
        if match:
            width, height = int(match.group(1)), int(match.group(2))
    if width > 0 and height > 0:
        return min(width, height)
    return height


def _best_by_quality(
    formats: list[dict[str, Any]],
    predicate: Callable[[dict[str, Any]], bool],
) -> list[tuple[int, dict[str, Any]]]:
    """Koşulu sağlayan formatları kaliteye göre gruplar (yüksekten alçağa).

    Aynı kalitede birden çok kayıt varsa bit hızı yüksek olan seçilir.
    """
    by_height: dict[int, tuple[dict[str, Any], float]] = {}
    for fmt in formats:
        if not predicate(fmt):
            continue
        quality = _quality_height(fmt)
        if quality <= 0:
            continue
        tbr = float(fmt.get("tbr") or 0)
        current = by_height.get(quality)
        if current is None or tbr > current[1]:
            by_height[quality] = (fmt, tbr)

    return [(quality, by_height[quality][0]) for quality in sorted(by_height, reverse=True)]


def _hls_variants(formats: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """YouTube HLS video varyantları (yüksekten alçağa).

    YouTube hem AVC hem VP9 kodlu varyantlar sunduğu için aynı yükseklikte
    birden çok kayıt gelir; önizlemede bit hızı yüksek olan tercih edilir.
    Liste 1080p ile sınırlanmaz — varsayılan kalite ayrıca seçilir.
    """
    pairs = _best_by_quality(
        formats,
        lambda fmt: "manifest.googlevideo.com" in (fmt.get("url") or ""),
    )
    return [
        _variant(fmt["url"], quality, hls=True, has_audio=_has_audio(fmt), audio_url=None)
        for quality, fmt in pairs
    ]


def _twitter_variants(formats: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """X/Twitter varyantları: önce ilerici (muxed) mp4, yoksa HLS görüntü.

    X'in `http-*` ilerici mp4'leri video+ses birlikte gelir; yt-dlp bu
    formatlarda kodek alanlarını boş bıraktığı için "ses yok" sanılmamalıdır
    (aksi halde video kendi sesini çalarken ayrı ses akışı da eklenir → çift ses).
    """
    progressive = _best_by_quality(
        formats,
        lambda fmt: "video.twimg.com" in (fmt.get("url") or "")
        and "m3u8" not in (fmt.get("url") or "").lower()
        and (fmt.get("vcodec") or "") != "none",
    )
    if progressive:
        return [
            _variant(fmt["url"], quality, hls=False, has_audio=True, audio_url=None)
            for quality, fmt in progressive
        ]

    # Yedek: yalnızca HLS varsa görüntü-only varyantlar + ayrı ses akışı.
    hls_pairs = _best_by_quality(
        formats,
        lambda fmt: "m3u8" in (fmt.get("url") or "").lower()
        and (fmt.get("vcodec") or "") != "none",
    )
    return [
        _variant(fmt["url"], quality, hls=True, has_audio=False, audio_url=None)
        for quality, fmt in hls_pairs
    ]


def _instagram_variants(formats: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Instagram varyantları: DASH görüntü akışları + ayrı ses (YouTube gibi).

    Instagram gönderileri genelde DASH manifesti verir; görüntü ve ses ayrı
    akışlardadır. DASH yoksa ilerici mp4 gelir: o kayıtlar video+ses birlikte
    taşır ama yt-dlp çözünürlük bildirmediği için tek "Kaynak" varyantı sunulur.
    """
    dash_pairs = _best_by_quality(
        formats,
        lambda fmt: (fmt.get("vcodec") or "") not in ("", "none")
        and (fmt.get("acodec") or "none") == "none",
    )
    if dash_pairs:
        return [
            _variant(fmt["url"], quality, hls=False, has_audio=False, audio_url=None)
            for quality, fmt in dash_pairs
        ]

    # Yedek: ilerici mp4 (kodek alanları boş → ilerici kayıt). yt-dlp varsayılanı
    # gibi son kayıt seçilir; ses varlığı `acodec: none` ile ayırt edilir.
    progressive = [
        fmt
        for fmt in formats
        if fmt.get("url")
        and (fmt.get("ext") or "").lower() == "mp4"
        and (fmt.get("vcodec") or "none") == "none"
        and (fmt.get("acodec") or "none") == "none"
    ]
    if not progressive:
        return []

    picked = progressive[-1]
    return [
        _variant(
            picked["url"],
            0,
            hls=False,
            has_audio=(picked.get("acodec") or "none") != "none",
            audio_url=None,
        )
    ]


class ResolveError(Exception):
    def __init__(
        self,
        message: str,
        status_code: int = 400,
        *,
        ytdlp_missing: bool = False,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.ytdlp_missing = ytdlp_missing


def _source_access_error(status: int) -> ResolveError:
    """Doğrudan kaynak erişim hatalarını eyleme dönük bir mesaja çevirir."""
    if status in (401, 403):
        return ResolveError(t("error.sourceAccessDenied", status=status), 403)
    if status == 404:
        return ResolveError(t("error.sourceNotFound"), 404)
    if status == 429:
        return ResolveError(t("error.sourceRateLimited"), 429)
    return ResolveError(t("error.sourceServer", status=status), 502)


def is_youtube_url(url: str) -> bool:
    return bool(re.search(r"(youtube\.com|youtu\.be)", url or "", re.IGNORECASE))


def is_twitter_url(url: str) -> bool:
    """x.com / twitter.com bağlantısı mı? (yt-dlp'nin `twitter` çıkarıcısı)"""
    host = (urllib.parse.urlparse(url or "").hostname or "").lower()
    return host in {"x.com", "twitter.com"} or host.endswith((".x.com", ".twitter.com"))


def is_instagram_url(url: str) -> bool:
    """instagram.com bağlantısı mı? (yt-dlp'nin `instagram` çıkarıcısı)"""
    host = (urllib.parse.urlparse(url or "").hostname or "").lower()
    return host == "instagram.com" or host.endswith(".instagram.com")


def is_tiktok_url(url: str) -> bool:
    """TikTok video/canlı yayın bağlantısı mı? (yt-dlp `TikTok` / `tiktok:live`)"""
    host = (urllib.parse.urlparse(url or "").hostname or "").lower()
    return host == "tiktok.com" or host.endswith(".tiktok.com")


def _tiktok_live_uploader(url: str) -> Optional[str]:
    """`/@kullanici/live` biçimindeki TikTok canlı yayın kullanıcısını döndürür."""
    path = urllib.parse.urlparse(url).path
    match = re.match(r"^/@([\w.-]+)/live/?$", path, re.IGNORECASE)
    return match.group(1) if match else None


def _lookup_tiktok_live_room(uploader: str, referer: str) -> Optional[str]:
    """TikTok web API'sinden canlı oda kimliğini alır.

    TikTok'un profil sayfası bot koruması nedeniyle yt-dlp'ye oda kimliği
    vermeyebiliyor. Bu genel JSON uç noktası oda kimliğini doğrudan döndürür;
    ardından yt-dlp mobil paylaşım URL'siyle (profil sayfasına girmeden)
    yayın akışlarını çözebilir.

    Oda kesin olarak kapalıysa `ResolveError`, API'ye ulaşılamazsa `None`
    döndürür. `None` durumunda eski yöntem (doğrudan URL) denenir.
    """
    query = urllib.parse.urlencode({"aid": "1988", "sourceType": "54", "uniqueId": uploader})
    request = urllib.request.Request(
        f"https://www.tiktok.com/api-live/user/room/?{query}",
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            "Accept": "application/json, text/plain, */*",
            "Referer": referer,
            "Origin": "https://www.tiktok.com",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            payload = json.loads(response.read().decode("utf-8", errors="ignore"))
    except Exception:
        return None

    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        return None

    live_room = data.get("liveRoom")
    if not isinstance(live_room, dict):
        return None

    user = data.get("user") if isinstance(data.get("user"), dict) else {}
    room_id = user.get("roomId")
    status = live_room.get("status")
    if str(status) == "2" and room_id:
        return str(room_id)
    if status is not None:
        # Oda kaydı var ama yayında değil (status 4 = bitmiş/çevrimdışı).
        raise ResolveError(t("error.tiktokOffline"))
    return None


def normalize_url(url: str) -> str:
    """Şemasız yapıştırılan bağlantıları (ör. `x.com/...`) `https://` ile tamamlar."""
    text = (url or "").strip()
    if not text or "://" in text:
        return text
    return f"https://{text.lstrip('/')}"


def platform_of(url: str) -> str:
    """Bağlantının platformu: `youtube` | `twitter` | `instagram` | `tiktok` | `direct`."""
    url = normalize_url(url)
    if is_youtube_url(url):
        return "youtube"
    if is_twitter_url(url):
        return "twitter"
    if is_instagram_url(url):
        return "instagram"
    if is_tiktok_url(url):
        return "tiktok"
    return "direct"


def is_ytdlp_url(url: str) -> bool:
    """yt-dlp ile çözülen platform bağlantısı mı?"""
    return platform_of(url) != "direct"


#: None = henüz aranmadı, False = bulunamadı, liste = çalıştırma komutu
_ytdlp_command: list[str] | None | bool = None


def find_ytdlp_command() -> Optional[list[str]]:
    """yt-dlp'yi PATH'te ya da mevcut Python ortamında arar (sonuç önbelleklenir)."""
    global _ytdlp_command
    if _ytdlp_command is not None:
        return _ytdlp_command or None

    if shutil.which("yt-dlp"):
        _ytdlp_command = ["yt-dlp"]
        return _ytdlp_command

    try:
        result = subprocess.run(
            [sys.executable, "-m", "yt_dlp", "--version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            _ytdlp_command = [sys.executable, "-m", "yt_dlp"]
            return _ytdlp_command
    except Exception:
        pass

    _ytdlp_command = False
    return None


async def resolve_url(
    url: str, client=None, headers: Optional[dict[str, str]] = None
) -> dict[str, Any]:
    """YouTube/X/Instagram/TikTok linklerini doğrudan oynatılabilir akışa çözer;
    diğer URL'leri (m3u8 master ise tek varyanta indirgeyerek) döndürür.

    `headers` yalnızca doğrudan medya bağlantılarında kullanılır (curl ile
    yapıştırılan cookie/referer gibi başlıklar). yt-dlp platformlarında hesap
    güvenliği için çerez kullanılmaz.
    """
    url = normalize_url(url)
    platform = platform_of(url)
    if platform == "direct":
        return await _resolve_direct(url, client, headers)

    # TikTok profil sayfası bot korumasına takılıp oda kimliğini vermeyebilir.
    # Canlı oda kimliğini web API'sinden alıp yt-dlp'ye mobil paylaşım URL'si
    # vererek profil sayfası adımını tamamen atlarız.
    target_url = url
    if platform == "tiktok":
        uploader = _tiktok_live_uploader(url)
        if uploader:
            room_id = await asyncio.to_thread(
                _lookup_tiktok_live_room, uploader, url
            )
            if room_id:
                target_url = f"https://m.tiktok.com/share/live/{room_id}/"

    command = find_ytdlp_command()
    if not command:
        raise ResolveError(
            t("error.ytdlpMissing"),
            status_code=422,
            ytdlp_missing=True,
        )

    dump_command = command + ["--dump-single-json", "--no-playlist", "--no-warnings"]
    if shutil.which("node"):
        dump_command.extend(["--js-runtimes", "node"])
    dump_command.append(target_url)

    process = await asyncio.create_subprocess_exec(
        *dump_command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=45.0)
    except asyncio.TimeoutError:
        try:
            process.kill()
        except Exception:
            pass
        raise ResolveError(
            t("error.ytdlpTimeout"),
            status_code=504,
        ) from None

    if process.returncode != 0:
        message = stderr.decode("utf-8", errors="ignore").strip()
        lowered = message.lower()
        if platform == "instagram" and "empty media response" in lowered:
            message = t("error.instagramLogin")
        elif platform == "tiktok":
            if any(
                marker in lowered
                for marker in (
                    "not currently live",
                    "is not live",
                    "user is not live",
                    "livestream has ended",
                )
            ):
                message = t("error.tiktokOffline")
            elif "login" in lowered or "log in" in lowered:
                message = t("error.tiktokLogin")
        raise ResolveError(message or t("error.ytdlpNoInfo"))

    info = json.loads(stdout.decode("utf-8", errors="ignore"))
    formats = info.get("formats", [])
    is_live = bool(info.get("is_live") or info.get("live_status") == "is_live")
    live_status = info.get("live_status") or ("is_live" if is_live else None)

    if platform == "twitter":
        variants = _twitter_variants(formats)
    elif platform == "instagram":
        variants = _instagram_variants(formats)
    elif platform == "tiktok":
        if is_live:
            variants = _tiktok_live_variants(formats)
        else:
            picked = _pick_tiktok_stream(formats, live=False)
            variants = [
                _variant(
                    picked["url"],
                    picked["height"],
                    hls=picked["hls"],
                    has_audio=picked["has_audio"],
                    audio_url=None,
                )
            ] if picked else []
    else:
        variants = _hls_variants(formats)

    if not variants:
        # HLS yoksa: sesli ilerici MP4 ya da herhangi bir video akışı (tek varyant).
        picked = _pick_stream(formats)
        if not picked:
            raise ResolveError(t("error.noPlayableStream"))
        variants = [
            _variant(
                picked["url"],
                picked["height"],
                hls=picked["hls"],
                has_audio=picked["has_audio"],
                audio_url=None,
            )
        ]

    # Varsayılan önizleme: 1080p'yi aşmayan en yüksek varyant (ör. 2160p olsa bile
    # oynatma 1080p'de başlar; daha yüksek kaliteler listede seçilebilir kalır).
    default_height = _pick_default_height(variants)
    best = next(item for item in variants if _variant_quality(item) == default_height)

    # Video akışı sessizse (YouTube HLS'leri yalnızca görüntü içerir) sesi ayrı
    # bir akıştan vermek gerekir: tarayıcı video + ses elementi eşlenerek oynatır,
    # dışa aktarmada FFmpeg ikisini birleştirir.
    audio_url = None if best["has_audio"] else _pick_audio(formats)

    for variant in variants:
        variant["audio_url"] = None if variant["has_audio"] else audio_url
        variant["default"] = _variant_quality(variant) == default_height

    selected_headers = next(
        (
            fmt.get("http_headers")
            for fmt in formats
            if fmt.get("url") == best["url"]
            and isinstance(fmt.get("http_headers"), dict)
        ),
        None,
    )

    return {
        "success": True,
        "platform": platform,
        "is_youtube": platform == "youtube",
        "is_twitter": platform == "twitter",
        "is_instagram": platform == "instagram",
        "is_tiktok": platform == "tiktok",
        "is_live": is_live,
        "live_status": live_status,
        "is_m3u8": best["hls"],
        "stream_url": best["url"],
        "original_url": url,
        "title": info.get("title") or info.get("uploader") or "Video",
        "duration": float(info.get("duration") or 0),
        "resolution": f"{_variant_quality(best)}p" if _variant_quality(best) else "",
        "has_audio": best["has_audio"],
        "audio_url": audio_url,
        "audio_tracks": [],
        "subtitle_tracks": [],
        #: Kaynak panelindeki kalite listesi (varsayılan `default: true` ile işaretli).
        "variants": variants,
        #: TikTok CDN'i çoğu zaman sayfa referer'ı ister; API bunu proxy
        #: belirtecine kaydeder ve yanıttan çıkarır.
        "http_headers": (
            {**(selected_headers or {}), "Referer": "https://www.tiktok.com/"}
            if platform == "tiktok"
            else None
        ),
    }


async def _resolve_direct(
    url: str, client, headers: Optional[dict[str, str]] = None
) -> dict[str, Any]:
    """Doğrudan medya bağlantıları — HLS master playlist'i kalite listesine indirger."""
    # HLS her zaman `.m3u8` uzantısı taşımaz; CDN'ler playlist'i uzantısız
    # sunabilir. İçerik türü/ilk baytlar üzerinden tespit edilir. 403/404 gibi
    # erişim hataları doğrudan anlaşılır bir çözümleme hatasına dönüşür.
    is_hls, access_status = await detect_hls_result(client, url, headers)
    if access_status and access_status >= 400:
        raise _source_access_error(access_status)

    result: dict[str, Any] = {
        "success": True,
        "platform": "direct",
        "is_youtube": False,
        "is_twitter": False,
        "is_instagram": False,
        "is_tiktok": False,
        "is_live": False,
        "live_status": None,
        "is_m3u8": is_hls,
        "stream_url": url,
        "resolution": "",
        "has_audio": None,
        "audio_url": None,
        "audio_tracks": [],
        "subtitle_tracks": [],
        "variants": [],
    }

    if not is_hls:
        return result

    try:
        variants = await list_variants(client, url, headers)
    except HlsRequestError as exc:
        raise ResolveError(str(exc), status_code=exc.status_code) from exc
    if not variants:
        return result

    default_height = _pick_default_height(variants)
    best = next(item for item in variants if _variant_quality(item) == default_height)
    result["stream_url"] = best["url"]
    if _variant_quality(best):
        result["resolution"] = f"{_variant_quality(best)}p"

    # Master playlist ayrı bir ses grubu içeriyorsa (ör. `AUDIO="audio0"`)
    # varyant yalnızca görüntü taşır. Ses playlist'i ayrıca verilir; oynatıcı
    # iki HLS akışını eşler, dışa aktarma ise FFmpeg ile birleştirir. Aynı
    # grupta birden çok rendition varsa tümü seçim için ayrıca listelenir.
    audio_tracks = best.get("audio_tracks") or []
    default_audio = best.get("audio_url")
    subtitle_tracks = best.get("subtitle_tracks") or []
    result["audio_tracks"] = audio_tracks
    result["subtitle_tracks"] = subtitle_tracks
    result["audio_url"] = default_audio
    result["has_audio"] = False if audio_tracks or default_audio else None
    result["variants"] = [
        {
            **_variant(
                item["url"],
                item["height"],
                hls=True,
                has_audio=False
                if item.get("audio_tracks") or item.get("audio_url")
                else None,
                audio_url=item.get("audio_url"),
                audio_hls=bool(item.get("audio_tracks") or item.get("audio_url")),
                audio_tracks=item.get("audio_tracks"),
                subtitle_tracks=item.get("subtitle_tracks"),
                quality_height=item.get("quality_height"),
            ),
            "default": _variant_quality(item) == default_height,
        }
        for item in variants
    ]
    return result


def _has_audio(fmt: dict[str, Any]) -> bool:
    """Formatın ses akışı içerip içermediği (yt-dlp acodec alanı)."""
    acodec = fmt.get("acodec")
    return bool(acodec and acodec != "none")


def _is_hls_format(fmt: dict[str, Any]) -> bool:
    protocol = str(fmt.get("protocol") or "").lower()
    url = str(fmt.get("url") or "").lower()
    return (
        protocol.startswith("m3u8")
        or (fmt.get("ext") or "").lower() in {"m3u8", "m3u"}
        or ".m3u8" in url
    )


def _pick_tiktok_stream(
    formats: list[dict[str, Any]], *, live: bool
) -> Optional[dict[str, Any]]:
    """TikTok için oynatılabilir akışı seç.

    Canlı yayınlarda tarayıcı FLV oynatamaz; bu yüzden önce HLS varyantı
    aranır. TikTok normal videolarında ise mevcut ilerici MP4 seçimi kullanılır.
    """
    if live:
        hls_formats = [
            fmt
            for fmt in formats
            if fmt.get("url") and _is_hls_format(fmt)
        ]
        if hls_formats:
            best = max(
                hls_formats,
                key=lambda fmt: (
                    float(fmt.get("quality") or 0),
                    _quality_height(fmt),
                    float(fmt.get("tbr") or 0),
                ),
            )
            # Aynı URL `hls-pull` ve `hls-hd` gibi birden çok kayıtta
            # görünebilir; çözünürlük bilgisi yalnızca birinde olabilir.
            same_url = [fmt for fmt in hls_formats if fmt.get("url") == best["url"]]
            height = max((_quality_height(fmt) for fmt in same_url), default=0)
            return {
                "url": best["url"],
                "height": height,
                "hls": True,
                # Canlı HLS akışı sesiyle birlikte gelir; yt-dlp acodec
                # bildirmediğinde ayrı ses akışı aramak yanlış olur.
                "has_audio": (best.get("acodec") or "aac") != "none",
            }
    return _pick_stream(formats)


def _tiktok_live_variants(formats: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """TikTok canlı yayınının sunduğu HLS kalitelerini listeler.

    Aynı HLS URL'si yt-dlp çıktısında `hls-hd` ve `hls-pull` gibi birden çok
    kayıtla gelebilir; URL'leri tekilleştirip her çözünürlük için en yüksek bit
    hızlı kaydı tutarız. Böylece arayüzdeki önizleme kalitesi seçicisi canlı
    yayınlarda da çalışır.
    """
    hls_formats = [
        fmt
        for fmt in formats
        if fmt.get("url")
        and _is_hls_format(fmt)
        and (fmt.get("vcodec") or "") != "none"
    ]
    if not hls_formats:
        return []

    by_url: dict[str, dict[str, Any]] = {}
    for fmt in hls_formats:
        url = fmt["url"]
        height = _quality_height(fmt)
        tbr = float(fmt.get("tbr") or 0)
        current = by_url.get(url)
        if current is None or (height, tbr) > (current["height"], current["tbr"]):
            by_url[url] = {"url": url, "height": height, "tbr": tbr, "fmt": fmt}

    by_height: dict[int, dict[str, Any]] = {}
    unknown: list[dict[str, Any]] = []
    for item in by_url.values():
        if item["height"] <= 0:
            unknown.append(item)
            continue
        current = by_height.get(item["height"])
        if current is None or item["tbr"] > current["tbr"]:
            by_height[item["height"]] = item

    items = sorted(by_height.values(), key=lambda item: item["height"], reverse=True)
    if not items and unknown:
        # Çözünürlük bilgisi yoksa tek bir en iyi akış sun; aynı 0p etiketiyle
        # birden çok seçenek göstermenin anlamı yok.
        items = [
            max(
                unknown,
                key=lambda item: (
                    float(item["fmt"].get("quality") or 0),
                    item["tbr"],
                ),
            )
        ]

    return [
        _variant(
            item["url"],
            item["height"],
            hls=True,
            # Canlı HLS akışı sesiyle birlikte gelir; yt-dlp acodec
            # bildirmediğinde ayrı ses akışı aramak yanlış olur.
            has_audio=(item["fmt"].get("acodec") or "aac") != "none",
            audio_url=None,
        )
        for item in items
    ]


def _pick_stream(formats: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Öncelik: HLS manifest > sesli ilerici MP4 > herhangi bir video akışı."""
    best: Optional[dict[str, Any]] = None
    best_height = 0
    for fmt in formats:
        fmt_url = fmt.get("url") or ""
        if "manifest.googlevideo.com" in fmt_url and fmt.get("resolution") != "audio only":
            height = _quality_height(fmt)
            if height > best_height:
                best_height = height
                best = fmt
    if best:
        return {
            "url": best["url"],
            "height": best_height,
            "hls": True,
            "has_audio": _has_audio(best),
        }

    for fmt in reversed(formats):
        if fmt.get("url") and fmt.get("ext") == "mp4" and _has_audio(fmt) and fmt.get("vcodec") not in (None, "none"):
            return {
                "url": fmt["url"],
                "height": _quality_height(fmt),
                "hls": False,
                "has_audio": True,
            }

    for fmt in reversed(formats):
        ext = (fmt.get("ext") or "").lower()
        if (
            fmt.get("url")
            and ext not in {"mhtml", "jpg", "jpeg", "webp"}
            and fmt.get("vcodec") not in (None, "none")
        ):
            return {
                "url": fmt["url"],
                "height": _quality_height(fmt),
                "hls": _is_hls_format(fmt),
                "has_audio": _has_audio(fmt),
            }

    return None


#: Tarayıcı ve FFmpeg'in doğrudan çalabildiği ses kapsayıcıları (AAC).
DIRECT_AUDIO_EXTENSIONS = {"m4a", "mp4"}


def _pick_audio(formats: list[dict[str, Any]]) -> Optional[str]:
    """Video akışı sessizse kullanılacak en iyi ses-yalnız akış.

    Önce `m4a`/`mp4` (AAC) tercih edilir: hem `<audio>` elementi hem FFmpeg
    doğrudan çalar. Bit hızı en yüksek olan seçilir.
    """
    best_url: Optional[str] = None
    best_score = -1.0

    for fmt in formats:
        fmt_url = fmt.get("url") or ""
        if not fmt_url or not _has_audio(fmt) or fmt.get("vcodec") not in (None, "none"):
            continue

        score = float(fmt.get("abr") or fmt.get("tbr") or 0)
        if (fmt.get("ext") or "").lower() in DIRECT_AUDIO_EXTENSIONS:
            score += 10_000  # AAC tercihi
        if score > best_score:
            best_score = score
            best_url = fmt_url

    return best_url
