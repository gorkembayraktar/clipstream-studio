"""HLS WebVTT altyazılarını tek bir oynatılabilir WebVTT metnine dönüştürür.

Tarayıcılar HLS altyazı playlist'ini doğrudan bir `<track>` kaynağı olarak
oynatamaz. Master playlist'teki `EXT-X-MEDIA TYPE=SUBTITLES` rendition'ı
genellikle WebVTT parçalarından oluşan bir medya playlist'idir; bu modül
parçaları sırayla indirip zaman damgalarını koruyarak birleştirir.
"""
import asyncio
import re
from typing import Any, Optional

from core.i18n import t
from services.segment_downloader import parse_media_playlist

#: Aynı anda indirilecek altyazı parçası sayısı.
SUBTITLE_CONCURRENCY = 8

#: VTT zaman damgası: `MM:SS.mmm` veya `HH:MM:SS.mmm`.
TIMESTAMP = re.compile(
    r"(?P<hours>\d{2,}):(?P<minutes>\d{2}):(?P<seconds>\d{2})\.(?P<millis>\d{3})"
)
SHORT_TIMESTAMP = re.compile(
    r"(?P<minutes>\d{2}):(?P<seconds>\d{2})\.(?P<millis>\d{3})"
)
CUE_TIMING = re.compile(
    r"(?P<start>\d{2,}:\d{2}(?::\d{2})?\.\d{3})\s*-->\s*"
    r"(?P<end>\d{2,}:\d{2}(?::\d{2})?\.\d{3})"
)
TIMESTAMP_MAP = re.compile(
    r"X-TIMESTAMP-MAP\s*=\s*LOCAL:(?P<local>[^,\s]+)\s*,\s*MPEGTS:(?P<mpegts>\d+)",
    re.IGNORECASE,
)


class SubtitleError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _http_error(status: int, url: str) -> SubtitleError:
    if status in (401, 403):
        return SubtitleError(t("error.subtitleForbidden", status=status), 403)
    if status == 404:
        return SubtitleError(t("error.subtitleNotFound"), 404)
    if status == 429:
        return SubtitleError(t("error.subtitleRateLimited"), 429)
    return SubtitleError(
        t("error.subtitleFetchFailed", detail=f"HTTP {status}"), 502
    )


def _parse_time(value: str) -> float:
    match = TIMESTAMP.fullmatch(value)
    if match:
        return (
            int(match.group("hours")) * 3600
            + int(match.group("minutes")) * 60
            + int(match.group("seconds"))
            + int(match.group("millis")) / 1000
        )
    short = SHORT_TIMESTAMP.fullmatch(value)
    if short:
        return (
            int(short.group("minutes")) * 60
            + int(short.group("seconds"))
            + int(short.group("millis")) / 1000
        )
    return 0.0


def _format_time(seconds: float) -> str:
    total_ms = int(round(max(0.0, seconds) * 1000))
    hours, remainder = divmod(total_ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    whole, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{whole:02d}.{millis:03d}"


def _timestamp_map_offset(header: str, segment_start: float) -> Optional[float]:
    """`X-TIMESTAMP-MAP` varsa segmentin medya zamanına göre ofsetini verir."""
    match = TIMESTAMP_MAP.search(header)
    if not match:
        return None
    local = _parse_time(match.group("local"))
    mpegts = int(match.group("mpegts")) / 90000.0
    # LOCAL, segment içindeki cue zamanlarının başlangıcı; MPEGTS ise medya
    # zaman çizgisindeki karşılığıdır. İkisinin farkı cue'lara eklenir.
    return mpegts - local


def _body_after_header(text: str) -> tuple[str, str]:
    """WebVTT başlığını ve `X-TIMESTAMP-MAP` satırlarını ayırır."""
    text = text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    if lines and lines[0].strip().upper().startswith("WEBVTT"):
        end = 1
        while end < len(lines) and lines[end].strip():
            end += 1
        header = "\n".join(lines[:end])
        body = "\n".join(lines[end + 1 :]) if end < len(lines) else ""
        return header, body.strip("\n")
    return "", text.strip("\n")


def _shift_cues(body: str, offset: float) -> str:
    if abs(offset) < 0.0005:
        return body

    def replace(match: re.Match[str]) -> str:
        start = _parse_time(match.group("start")) + offset
        end = _parse_time(match.group("end")) + offset
        return f"{_format_time(start)} --> {_format_time(end)}"

    return CUE_TIMING.sub(replace, body)


def _normalize_segment(text: str, segment_start: float) -> str:
    header, body = _body_after_header(text)
    if not body:
        return ""

    # Önce zaman haritasını kullan; yoksa segmentin playlist başlangıcına göre
    # yerel (sıfırdan başlayan) cue'ları medya zaman çizgisine taşı.
    offset = _timestamp_map_offset(header, segment_start)
    if offset is None and segment_start > 1:
        first = CUE_TIMING.search(body)
        if first:
            first_start = _parse_time(first.group("start"))
            if first_start + 1 < segment_start:
                offset = segment_start
    return _shift_cues(body, offset or 0.0).strip("\n")


def _join_segments(segments: list[str]) -> str:
    blocks = [segment for segment in segments if segment.strip()]
    if not blocks:
        raise SubtitleError(t("error.subtitleNoCues"), 422)
    return "WEBVTT\n\n" + "\n\n".join(blocks) + "\n"


async def build_webvtt(
    client: Any,
    url: str,
    headers: Optional[dict[str, str]] = None,
) -> str:
    """Bir WebVTT dosyasını ya da HLS altyazı playlist'ini tek VTT'ye çevirir."""
    if client is None:
        raise SubtitleError(t("error.subtitleFetchFailed", detail="no HTTP client"), 500)

    try:
        response = await client.get(url, headers=headers or None)
        response.raise_for_status()
    except SubtitleError:
        raise
    except Exception as exc:
        # httpx HTTPStatusError durum kodunu taşır; diğerleri ağ/CORS hatasıdır.
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if isinstance(status, int):
            raise _http_error(status, url) from exc
        raise SubtitleError(
            t("error.subtitleFetchFailed", detail=str(exc) or type(exc).__name__),
            502,
        ) from exc

    text = response.text.lstrip("\ufeff")
    if text.lstrip().upper().startswith("WEBVTT"):
        return text

    if "#EXTM3U" not in text:
        raise SubtitleError(t("error.subtitleUnsupported"), 422)

    playlist = parse_media_playlist(text, str(getattr(response, "url", url)))
    if playlist is None:
        raise SubtitleError(t("error.subtitleUnsupported"), 422)
    if playlist.encrypted or playlist.byterange:
        raise SubtitleError(t("error.subtitleEncrypted"), 422)

    semaphore = asyncio.Semaphore(SUBTITLE_CONCURRENCY)
    starts: list[float] = []
    cursor = 0.0
    for segment in playlist.segments:
        starts.append(cursor)
        cursor += segment.duration

    async def fetch(index: int):
        segment = playlist.segments[index]
        async with semaphore:
            try:
                segment_response = await client.get(
                    segment.url, headers=headers or None
                )
                segment_response.raise_for_status()
            except Exception as exc:
                status = getattr(
                    getattr(exc, "response", None), "status_code", None
                )
                if isinstance(status, int):
                    raise _http_error(status, segment.url) from exc
                raise SubtitleError(
                    t(
                        "error.subtitleFetchFailed",
                        detail=str(exc) or type(exc).__name__,
                    ),
                    502,
                ) from exc
            return index, segment_response.text

    try:
        results = await asyncio.gather(
            *(fetch(index) for index in range(len(playlist.segments)))
        )
    except SubtitleError:
        raise
    except Exception as exc:
        raise SubtitleError(
            t("error.subtitleFetchFailed", detail=str(exc)), 502
        ) from exc

    normalized = [
        _normalize_segment(segment_text, starts[index])
        for index, segment_text in sorted(results)
    ]
    return _join_segments(normalized)
