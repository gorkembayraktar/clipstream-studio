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

STREAM_INF = re.compile(r"#EXT-X-STREAM-INF:(?P<attrs>.+)")
ATTRIBUTE = re.compile(r'(?P<key>[A-Z0-9\-]+)=(?P<value>"[^"]*"|[^,]*)')
RESOLUTION = re.compile(r"(?P<width>\d+)x(?P<height>\d+)")

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
    if ".m3u8" in (url or "").lower():
        return True
    if client is None:
        return False

    request_headers = headers or None

    try:
        response = await client.head(url, headers=request_headers)
        if response.status_code < 400 and is_hls_content_type(
            response.headers.get("content-type")
        ):
            return True
    except Exception:
        pass

    try:
        async with client.stream("GET", url, headers=request_headers) as response:
            if response.status_code >= 400:
                return False
            if is_hls_content_type(response.headers.get("content-type")):
                return True

            prefix = b""
            async for chunk in response.aiter_bytes():
                prefix += chunk
                if len(prefix) >= 1024:
                    break
            return prefix.lstrip(b"\xef\xbb\xbf \t\r\n").startswith(b"#EXTM3U")
    except Exception:
        return False


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
    """
    if client is None:
        return None

    try:
        response = await client.get(url, headers=headers or None)
        response.raise_for_status()
        text = response.text
    except Exception:
        return None

    if not is_master_playlist(text):
        return None

    return pick_best_variant(parse_playlist_variants(text, str(response.url)))


MEDIA_TAG = re.compile(r"#EXT-X-MEDIA:(?P<attrs>.+)")


def find_audio_playlist(
    text: str, base_url: str, group_id: Optional[str] = None
) -> Optional[str]:
    """Master playlist'teki ses grubunun adresini döner (varsa).

    `group_id` verilirse yalnızca o `GROUP-ID`'ye ait rendition'lar eşleşir;
    grup içinde `DEFAULT=YES` olan tercih edilir. Dalga formu çıkarımı gibi
    yalnızca sesin gerektiği işlerde tam videoyu indirmek yerine küçük ses
    playlist'ini kullanmayı sağlar.
    """
    fallback: Optional[str] = None
    for line in (item.strip() for item in text.splitlines()):
        match = MEDIA_TAG.match(line)
        if not match:
            continue

        attributes = {
            item.group("key"): item.group("value").strip('"')
            for item in ATTRIBUTE.finditer(match.group("attrs"))
        }
        if attributes.get("TYPE", "").upper() != "AUDIO":
            continue
        if group_id is not None and attributes.get("GROUP-ID") != group_id:
            continue

        uri = attributes.get("URI")
        if not uri:
            continue
        candidate = urljoin(base_url, uri)
        if attributes.get("DEFAULT", "").upper() == "YES":
            return candidate
        if fallback is None:
            fallback = candidate

    return fallback


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
        response.raise_for_status()
        text = response.text
    except Exception:
        return []

    if not is_master_playlist(text):
        return []

    base_url = str(response.url)
    variants = [
        item
        for item in parse_playlist_variants(text, base_url)
        if item["height"] > 0
    ]
    for item in variants:
        group = item.get("audio_group") or ""
        item["audio_url"] = (
            find_audio_playlist(text, base_url, group) if group else None
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
