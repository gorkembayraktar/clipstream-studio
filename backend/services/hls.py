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
        variants.append(
            {
                "url": urljoin(base_url, uri),
                "bandwidth": int(attributes.get("BANDWIDTH") or 0),
                "width": int(resolution.group("width")) if resolution else 0,
                "height": int(resolution.group("height")) if resolution else 0,
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


def find_audio_playlist(text: str, base_url: str) -> Optional[str]:
    """Master playlist'teki ses grubunun adresini döner (varsa).

    Dalga formu çıkarımı gibi yalnızca sesin gerektiği işlerde tam videoyu
    indirmek yerine küçük ses playlist'ini kullanmayı sağlar.
    """
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

        uri = attributes.get("URI")
        if uri:
            return urljoin(base_url, uri)

    return None


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

    variants = [item for item in parse_playlist_variants(text, str(response.url)) if item["height"] > 0]
    variants.sort(
        key=lambda item: (item["height"], item["width"], item["bandwidth"]),
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
