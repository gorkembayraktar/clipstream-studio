"""yt-dlp ile YouTube / X (Twitter) / Instagram bağlantılarını oynatılabilir akışa çözer."""
import asyncio
import json
import re
import shutil
import subprocess
import sys
import urllib.parse
from typing import Any, Callable, Optional

from core.i18n import t
from services.hls import list_variants

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
) -> dict[str, Any]:
    """Arayüzdeki kalite listesi için tek bir oynatma varyantı."""
    height = int(height or 0)
    return {
        "url": url,
        "height": height,
        "label": f"{height}p" if height else t("label.source"),
        "hls": hls,
        "has_audio": has_audio,
        "audio_url": audio_url,
        "default": False,
    }


def _pick_default_height(
    variants: list[dict[str, Any]], max_height: int = MAX_PREVIEW_HEIGHT
) -> int:
    """Varsayılan varyant: `max_height`'ı aşmayan en yüksek kalite (yoksa en yüksek)."""
    capped = [item for item in variants if 0 < item["height"] <= max_height]
    return int((capped[0] if capped else variants[0])["height"])


def _quality_height(fmt: dict[str, Any]) -> int:
    """Kalite ekseni: dikey videolarda da anlamlı olsun diye kısa kenar kullanılır.

    X/Twitter videolarının çoğu dikey (ör. 576x1024); YouTube'da da Shorts
    1080x1920 gelir. Kısa kenar sayesinde "1080p" sınırı doğru uygulanır.
    """
    width = int(fmt.get("width") or 0)
    height = int(fmt.get("height") or 0)
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


def normalize_url(url: str) -> str:
    """Şemasız yapıştırılan bağlantıları (ör. `x.com/...`) `https://` ile tamamlar."""
    text = (url or "").strip()
    if not text or "://" in text:
        return text
    return f"https://{text.lstrip('/')}"


def platform_of(url: str) -> str:
    """Bağlantının platformu: `youtube` | `twitter` | `instagram` | `direct`."""
    url = normalize_url(url)
    if is_youtube_url(url):
        return "youtube"
    if is_twitter_url(url):
        return "twitter"
    if is_instagram_url(url):
        return "instagram"
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
    """YouTube/X/Instagram linklerini doğrudan oynatılabilir akışa çözer;
    diğer URL'leri (m3u8 master ise tek varyanta indirgeyerek) döndürür.

    `headers` yalnızca doğrudan medya bağlantılarında kullanılır (curl ile
    yapıştırılan cookie/referer gibi başlıklar). yt-dlp platformlarında hesap
    güvenliği için çerez kullanılmaz.
    """
    url = normalize_url(url)
    platform = platform_of(url)
    if platform == "direct":
        return await _resolve_direct(url, client, headers)

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
    dump_command.append(url)

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
        if platform == "instagram" and "empty media response" in message.lower():
            message = t("error.instagramLogin")
        raise ResolveError(message or t("error.ytdlpNoInfo"))

    info = json.loads(stdout.decode("utf-8", errors="ignore"))
    formats = info.get("formats", [])
    if platform == "twitter":
        variants = _twitter_variants(formats)
    elif platform == "instagram":
        variants = _instagram_variants(formats)
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
    best = next(item for item in variants if item["height"] == default_height)

    # Video akışı sessizse (YouTube HLS'leri yalnızca görüntü içerir) sesi ayrı
    # bir akıştan vermek gerekir: tarayıcı video + ses elementi eşlenerek oynatır,
    # dışa aktarmada FFmpeg ikisini birleştirir.
    audio_url = None if best["has_audio"] else _pick_audio(formats)

    for variant in variants:
        variant["audio_url"] = None if variant["has_audio"] else audio_url
        variant["default"] = variant["height"] == default_height

    return {
        "success": True,
        "platform": platform,
        "is_youtube": platform == "youtube",
        "is_twitter": platform == "twitter",
        "is_instagram": platform == "instagram",
        "is_m3u8": best["hls"],
        "stream_url": best["url"],
        "original_url": url,
        "title": info.get("title") or info.get("uploader") or "Video",
        "duration": float(info.get("duration") or 0),
        "resolution": f"{best['height']}p" if best["height"] else "",
        "has_audio": best["has_audio"],
        "audio_url": audio_url,
        #: Kaynak panelindeki kalite listesi (varsayılan `default: true` ile işaretli).
        "variants": variants,
    }


async def _resolve_direct(
    url: str, client, headers: Optional[dict[str, str]] = None
) -> dict[str, Any]:
    """Doğrudan medya bağlantıları — m3u8 master playlist'i kalite listesine indirger."""
    result: dict[str, Any] = {
        "success": True,
        "platform": "direct",
        "is_youtube": False,
        "is_twitter": False,
        "is_instagram": False,
        "is_m3u8": ".m3u8" in url.lower(),
        "stream_url": url,
        "resolution": "",
        "has_audio": None,
        "audio_url": None,
        "variants": [],
    }

    if not result["is_m3u8"]:
        return result

    variants = await list_variants(client, url, headers)
    if not variants:
        return result

    default_height = _pick_default_height(variants)
    best = next(item for item in variants if item["height"] == default_height)
    result["stream_url"] = best["url"]
    if best["height"]:
        result["resolution"] = f"{best['height']}p"
    result["variants"] = [
        {
            **_variant(item["url"], item["height"], hls=True, has_audio=None, audio_url=None),
            "default": item["height"] == default_height,
        }
        for item in variants
    ]
    return result


def _has_audio(fmt: dict[str, Any]) -> bool:
    """Formatın ses akışı içerip içermediği (yt-dlp acodec alanı)."""
    acodec = fmt.get("acodec")
    return bool(acodec and acodec != "none")


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
                "hls": False,
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
