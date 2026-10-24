"""HLS master (çoklu varyantlı) playlist'lerden tek varyant seçimi.

Neden gerekli: master playlist'te ffprobe `v:0` ilk varyantı bildirirken ffmpeg
varsayılan akış seçiminde en yüksek çözünürlüklü varyantı kullanır. Bu fark,
arayüzde çizilen kırpma kutusunun dışa aktarılan videoda kaymasına yol açar.

Master playlist'i önceden en yüksek kaliteli varyanta indirgeyerek oynatma,
analiz ve dışa aktarmanın her zaman aynı görüntüyü kullanmasını sağlıyoruz.
"""
import re
from typing import Any, Optional
from urllib.parse import urljoin

from core.i18n import t

STREAM_INF = re.compile(r"#EXT-X-STREAM-INF:(?P<attrs>.+)")
ATTRIBUTE = re.compile(r'(?P<key>[A-Z0-9\-]+)=(?P<value>"[^"]*"|[^,]*)')
RESOLUTION = re.compile(r"(?P<width>\d+)x(?P<height>\d+)")

#: Master playlist tespiti için okunacak en fazla bayt. Doğrudan video veya
#: canlı akış adreslerinde yanıtın tamamını belleğe almamak için gereklidir.
MAX_PLAYLIST_BYTES = 1 << 20

#: Yayın kalitesi etiketi olarak kabul edilen standart yükseklikler. Kırpılmış
#: (ör. 1920x800) akışlarda piksel yüksekliği kalite sınıfını yansıtmaz.
STANDARD_HEIGHTS = {144, 240, 288, 360, 480, 540, 576, 720, 900, 1080, 1440, 2160}

#: 16:9 kalite basamaklarının genişlikleri. Yükseklik standart değilse (kırpılmış
#: sinema oranı) kalite, genişlikten bu tabloyla çıkarılır.
WIDTH_LADDER = (
    (3840, 2160),
    (2560, 1440),
    (1920, 1080),
    (1280, 720),
    (1024, 576),
    (960, 540),
    (854, 480),
    (640, 360),
    (426, 240),
    (256, 144),
)


def quality_height(width: int, height: int) -> int:
    """Bir varyantın yayın kalitesi etiketini (1080p gibi) döner.

    Bazı yayıncılar 1080p sinyali 1920x800 gibi kırpılmış sinema oranında
    sunar. Bu durumda ham yükseklik (800) "800p" gibi yanıltıcı bir etiket
    üretir; gerçek kalite sınıfı genişlikten (1920 → 1080p) bulunur. Standart
    yükseklikler (1080, 720, 480 ...) ve dikey videolar (1080x1920) doğrudan
    kendi kalitelerini korur.
    """
    width = int(width or 0)
    height = int(height or 0)
    if width <= 0 or height <= 0:
        return height
    if height >= width:
        # Dikey/kare video: kısa kenar kalite eksenidir (1080x1920 → 1080p).
        return width
    if height in STANDARD_HEIGHTS:
        return height
    for standard_width, standard_quality in WIDTH_LADDER:
        if width >= standard_width * 0.9:
            return standard_quality
    return height


#: HLS sunucularının döndürdüğü yaygın içerik türleri (büyük/küçük harf duyarsız).
HLS_CONTENT_TYPES = {
    "application/vnd.apple.mpegurl",
    "application/x-mpegurl",
    "application/mpegurl",
    "audio/mpegurl",
    "audio/x-mpegurl",
}


def is_hls_content_type(content_type: Optional[str]) -> bool:
    """`Content-Type` başlığı bir HLS playlist'ini mi işaret ediyor?"""
    mime = (content_type or "").split(";", 1)[0].strip().lower()
    return mime in HLS_CONTENT_TYPES or "mpegurl" in mime


class HlsRequestError(Exception):
    """HLS playlist isteği kullanıcıya gösterilebilir bir nedenle başarısız oldu."""

    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


def hls_status_error(status: int) -> HlsRequestError:
    if status in (401, 403):
        return HlsRequestError(t("error.hlsForbidden", status=status), 403)
    if status == 404:
        return HlsRequestError(t("error.hlsNotFound"), 404)
    if status == 429:
        return HlsRequestError(t("error.hlsRateLimited"), 429)
    return HlsRequestError(t("error.hlsServer", status=status), 502)


async def detect_hls_result(
    client, url: str, headers: Optional[dict[str, str]] = None
) -> tuple[bool, Optional[int]]:
    """HLS tespiti ve erişim hatası durum kodunu birlikte döner."""
    if ".m3u8" in (url or "").lower():
        return True, None
    if client is None:
        return False, None

    request_headers = headers or None
    head_status: Optional[int] = None

    try:
        response = await client.head(url, headers=request_headers)
        head_status = response.status_code
        if response.status_code < 400 and is_hls_content_type(
            response.headers.get("content-type")
        ):
            return True, None
    except Exception:
        pass

    try:
        async with client.stream("GET", url, headers=request_headers) as response:
            if response.status_code >= 400:
                return False, response.status_code
            if is_hls_content_type(response.headers.get("content-type")):
                return True, None

            prefix = b""
            async for chunk in response.aiter_bytes():
                prefix += chunk
                if len(prefix) >= 1024:
                    break
            return (
                prefix.lstrip(b"\xef\xbb\xbf \t\r\n").startswith(b"#EXTM3U"),
                None,
            )
    except Exception:
        return False, head_status if head_status and head_status >= 400 else None


async def detect_hls(
    client, url: str, headers: Optional[dict[str, str]] = None
) -> bool:
    """URL bir HLS kaynağı mı? Uzantı yoksa içerik türü/ilk baytlardan anlar.

    Bazı CDN'ler master playlist'i `.m3u8` uzantısı olmadan sunar. Yalnızca
    URL'ye bakmak bu kaynakları düz video sanmaya yol açar. Önce ucuz bir HEAD
    isteğiyle `Content-Type` kontrol edilir; sunucu bunu desteklemiyorsa ilk
    birkaç KB okunup `#EXTM3U` imzası aranır. Doğrudan MP4'lerde tam dosya
    indirilmez; akış erken kapatılır.
    """
    is_hls, _status = await detect_hls_result(client, url, headers)
    return is_hls


def is_master_playlist(text: str) -> bool:
    return "#EXT-X-STREAM-INF" in text


def parse_playlist_variants(text: str, base_url: str) -> list[dict[str, Any]]:
    """Master playlist metnindeki varyantları (url + kalite bilgisi) döner."""
    lines = [line.strip() for line in text.splitlines()]
    variants: list[dict[str, Any]] = []

    for index, line in enumerate(lines):
        match = STREAM_INF.match(line)
        if not match:
            continue

        attributes = {
            item.group("key"): item.group("value").strip('"')
            for item in ATTRIBUTE.finditer(match.group("attrs"))
        }
        uri = next(
            (candidate for candidate in lines[index + 1:] if candidate and not candidate.startswith("#")),
            "",
        )
        if not uri:
            continue

        resolution = RESOLUTION.match(attributes.get("RESOLUTION", "") or "")
        width = int(resolution.group("width")) if resolution else 0
        height = int(resolution.group("height")) if resolution else 0
        variants.append(
            {
                "url": urljoin(base_url, uri),
                "bandwidth": int(attributes.get("BANDWIDTH") or 0),
                "width": width,
                "height": height,
                # Kalite listesindeki etiket için gerçek yayın sınıfı (1920x800 → 1080).
                "quality_height": quality_height(width, height),
                # Varyant ayrı bir ses grubuna bağlıysa (AUDIO="audio0") bu kimlik
                # ses playlist'ini eşleştirmek için kullanılır.
                "audio_group": attributes.get("AUDIO", ""),
                # Altyazı grubu (SUBTITLES="subs") da aynı mantıkla eşleşir.
                "subtitle_group": attributes.get("SUBTITLES", ""),
            }
        )

    return variants


def pick_best_variant(variants: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """En yüksek çözünürlüklü (eşitlikte en yüksek bant genişlikli) varyantı seçer."""
    if not variants:
        return None
    return max(variants, key=lambda item: (item["height"], item["width"], item["bandwidth"]))


async def select_best_variant(
    client, url: str, headers: Optional[dict[str, str]] = None
) -> Optional[dict[str, Any]]:
    """Master playlist ise en iyi varyantı, media playlist ise None döner.

    Ağ hatalarında sessizce None döner; çağıran taraf özgün URL ile devam eder.
    Doğrudan video veya canlı akış adreslerinde yanıtın tamamı okunmaz:
    master playlist tespiti için yalnızca ilk `MAX_PLAYLIST_BYTES` bayt incelenir.
    """
    if client is None:
        return None

    try:
        async with client.stream("GET", url, headers=headers or None) as response:
            response.raise_for_status()
            body = bytearray()
            async for chunk in response.aiter_bytes():
                remaining = MAX_PLAYLIST_BYTES - len(body)
                if remaining <= 0:
                    break
                body.extend(chunk[:remaining])
                if len(body) >= MAX_PLAYLIST_BYTES:
                    break
            text = bytes(body).decode("utf-8", errors="replace")
            response_url = str(getattr(response, "url", None) or url)
    except Exception:
        return None

    if not is_master_playlist(text):
        return None

    return pick_best_variant(parse_playlist_variants(text, response_url))


MEDIA_TAG = re.compile(r"#EXT-X-MEDIA:(?P<attrs>.+)")


def parse_media_renditions(
    text: str, base_url: str, media_type: str = "AUDIO"
) -> list[dict[str, Any]]:
    """Master playlist'teki `EXT-X-MEDIA` rendition'larını döner.

    Aynı grup içinde birden çok ses/altyazı rendition'ı olabilir. Her kayıt
    kararlı bir `id` taşır; kullanıcı seçimi yeniden çözümlemede URL değişse
    bile bu kimlikle korunabilir.
    """
    wanted = media_type.upper()
    tracks: list[dict[str, Any]] = []
    used_ids: set[str] = set()

    for raw_line in text.splitlines():
        match = MEDIA_TAG.match(raw_line.strip())
        if not match:
            continue

        attributes = {
            item.group("key"): item.group("value").strip('"')
            for item in ATTRIBUTE.finditer(match.group("attrs"))
        }
        if attributes.get("TYPE", "").upper() != wanted:
            continue

        uri = attributes.get("URI")
        if not uri:
            continue

        group_id = attributes.get("GROUP-ID", "")
        name = attributes.get("NAME", "") or group_id or wanted.title()
        language = attributes.get("LANGUAGE", "")
        base_id = f"{group_id}|{language}|{name}"
        track_id = base_id
        suffix = 2
        while track_id in used_ids:
            track_id = f"{base_id}#{suffix}"
            suffix += 1
        used_ids.add(track_id)

        tracks.append(
            {
                "id": track_id,
                "group_id": group_id,
                "name": name,
                "language": language or None,
                "url": urljoin(base_url, uri),
                "hls": True,
                "default": attributes.get("DEFAULT", "").upper() == "YES",
                "autoselect": attributes.get("AUTOSELECT", "").upper() == "YES",
                "forced": attributes.get("FORCED", "").upper() == "YES",
            }
        )

    return tracks


def default_rendition(tracks: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Grup içinde DEFAULT, yoksa AUTOSELECT, yoksa ilk rendition'ı seçer."""
    if not tracks:
        return None
    return (
        next((track for track in tracks if track.get("default")), None)
        or next((track for track in tracks if track.get("autoselect")), None)
        or tracks[0]
    )


def find_audio_playlist(
    text: str, base_url: str, group_id: Optional[str] = None
) -> Optional[str]:
    """Master playlist'teki varsayılan ses rendition'ının adresini döner."""
    tracks = parse_media_renditions(text, base_url, "AUDIO")
    if group_id is not None:
        tracks = [track for track in tracks if track["group_id"] == group_id]
    selected = default_rendition(tracks)
    return selected["url"] if selected else None


async def list_variants(
    client, url: str, headers: Optional[dict[str, str]] = None
) -> list[dict[str, Any]]:
    """Master playlist varyantlarını yüksekten alçağa sıralı döner.

    Liste 1080p ile sınırlanmaz; varsayılan önizleme kalitesi çağıran tarafta
    seçilir. Master değilse ya da ağ hatasında boş liste döner (çağıran taraf
    özgün URL ile devam eder).
    """
    if client is None:
        return []

    try:
        response = await client.get(url, headers=headers or None)
    except Exception as exc:
        if "timeout" in type(exc).__name__.lower():
            raise HlsRequestError(t("error.hlsTimeout"), 504) from exc
        raise HlsRequestError(t("error.hlsNetwork"), 502) from exc

    if response.status_code >= 400:
        raise hls_status_error(response.status_code)

    try:
        text = response.text
    except Exception as exc:
        raise HlsRequestError(t("error.hlsNetwork"), 502) from exc

    if not is_master_playlist(text):
        return []

    base_url = str(response.url)
    variants = [
        item
        for item in parse_playlist_variants(text, base_url)
        if item["height"] > 0
    ]
    all_audio_tracks = parse_media_renditions(text, base_url, "AUDIO")
    all_subtitle_tracks = parse_media_renditions(text, base_url, "SUBTITLES")
    for item in variants:
        group = item.get("audio_group") or ""
        tracks = (
            [track for track in all_audio_tracks if track["group_id"] == group]
            if group
            else []
        )
        selected = default_rendition(tracks)
        item["audio_tracks"] = tracks
        item["audio_url"] = selected["url"] if selected else None

        subtitle_group = item.get("subtitle_group") or ""
        item["subtitle_tracks"] = (
            [
                track
                for track in all_subtitle_tracks
                if track["group_id"] == subtitle_group
            ]
            if subtitle_group
            else []
        )
    variants.sort(
        key=lambda item: (
            item.get("quality_height") or item["height"],
            item["height"],
            item["width"],
            item["bandwidth"],
        ),
        reverse=True,
    )
    return variants


def pick_lightest_variant(variants: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """En düşük bant genişlikli varyantı seçer (sesin yeterli olduğu işler için)."""
    if not variants:
        return None

    def weight(item: dict[str, Any]) -> int:
        bandwidth = int(item.get("bandwidth") or 0)
        if bandwidth:
            return bandwidth
        pixels = int(item.get("width") or 0) * int(item.get("height") or 0)
        return pixels or (1 << 30)

    return min(variants, key=weight)
