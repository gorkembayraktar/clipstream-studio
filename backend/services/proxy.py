"""CORS proxy'si: uzak yayınları tarayıcıya aktarır ve m3u8 içeriklerini yeniden yazar."""
import re
import urllib.parse
from typing import Optional

from starlette.responses import JSONResponse, Response, StreamingResponse

from core.i18n import t
from services.header_store import get_headers

BROWSER_HEADERS = {
    "Accept": "*/*",
}

#: m3u8 içindeki URI="..." taşıyan etiketler
_URI_TAG_PREFIXES = ("#EXT-X-KEY:", "#EXT-X-MAP:", "#EXT-X-MEDIA:", "#EXT-X-I-FRAME-STREAM-INF:")


def _proxy_link(absolute_url: str, token: Optional[str] = None) -> str:
    link = f"/api/media/proxy?url={urllib.parse.quote(absolute_url, safe='')}"
    if token:
        link += f"&t={urllib.parse.quote(token, safe='')}"
    return link


def _is_playlist(parsed: urllib.parse.ParseResult) -> bool:
    """Yalnızca yolun son parçasına bakılır.

    YouTube HLS segment URL'leri playlist yolunu da içerir
    (`.../playlist/index.m3u8/govp/slices=.../file/seg.ts`); bu yüzden metinde
    `.m3u8` aramak segmenti yanlışlıkla playlist sayar ve akış bozulur.
    """
    return parsed.path.lower().rstrip("/").endswith((".m3u8", ".m3u"))


def _rewrite_playlist(text: str, base_url: str, token: Optional[str] = None) -> str:
    """Playlist içindeki göreli/tam URL'leri proxy üzerinden geçecek şekilde çevirir."""
    rewritten: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            rewritten.append(line)
            continue

        if stripped.startswith("#"):
            if stripped.startswith(_URI_TAG_PREFIXES):
                line = re.sub(
                    r'URI="([^"]+)"',
                    lambda match: f'URI="{_proxy_link(urllib.parse.urljoin(base_url, match.group(1)), token)}"',
                    line,
                )
            rewritten.append(line)
        else:
            rewritten.append(_proxy_link(urllib.parse.urljoin(base_url, stripped), token))

    return "\n".join(rewritten)


async def proxy_request(request) -> Response:
    raw_url = request.query_params.get("url")
    if not raw_url:
        return JSONResponse({"error": t("error.proxyMissingUrl")}, status_code=400)

    # Starlette sorgu parametrelerini zaten çözer; burada ikinci kez çözmek
    # imzalı YouTube URL'lerini bozar (ör. `%3B` → `;`) ve googlevideo bu
    # bozuk adres için `/seg.ts` yerine anlamsız 3 KB'lık segment adresleri
    # döndürür (hepsi 403). Bu yüzden değer olduğu gibi kullanılır.
    target_url = raw_url
    parsed = urllib.parse.urlparse(target_url)
    http = request.app.state.http

    # curl ile yapıştırılan başlıklar (cookie/referer…) belirteçle geri alınır.
    token = request.query_params.get("t")
    custom_headers = get_headers(token)

    headers = dict(BROWSER_HEADERS)
    headers["User-Agent"] = request.app.state.user_agent
    if "range" in request.headers:
        headers["range"] = request.headers["range"]
    headers["referer"] = f"{parsed.scheme}://{parsed.netloc}/"
    headers.update(custom_headers)
    # Range her zaman tarayıcıdan gelen aralıktır (kaynak başlığı olamaz).
    if "range" in request.headers:
        headers["range"] = request.headers["range"]

    try:
        if _is_playlist(parsed):
            response = await http.get(target_url, headers=headers)
            content_type = response.headers.get("content-type", "application/vnd.apple.mpegurl")

            if "mpegurl" in content_type or "#EXTM3U" in response.text:
                body = _rewrite_playlist(response.text, str(response.url), token)
                return Response(
                    content=body.encode("utf-8"),
                    media_type="application/vnd.apple.mpegurl",
                    headers={"Access-Control-Allow-Origin": "*"},
                )

            return Response(
                content=response.content,
                status_code=response.status_code,
                media_type=content_type,
                headers={"Access-Control-Allow-Origin": "*"},
            )

        # Segment ve doğrudan dosyalar: bayt bayt, range desteğiyle akıt
        upstream = await http.send(
            http.build_request("GET", target_url, headers=headers),
            stream=True,
        )
        response_headers = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
            "Accept-Ranges": "bytes",
        }
        if "content-length" in upstream.headers:
            response_headers["Content-Length"] = upstream.headers["content-length"]
        if "content-range" in upstream.headers:
            response_headers["Content-Range"] = upstream.headers["content-range"]

        async def stream_body():
            try:
                async for chunk in upstream.aiter_bytes(chunk_size=65536):
                    yield chunk
            finally:
                await upstream.aclose()

        return StreamingResponse(
            stream_body(),
            status_code=upstream.status_code,
            media_type=upstream.headers.get("content-type", "video/mp2t"),
            headers=response_headers,
        )
    except Exception as exc:
        return JSONResponse({"error": t("error.proxyFailed", detail=exc)}, status_code=502)
