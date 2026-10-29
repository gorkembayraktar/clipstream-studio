"""CORS proxy'si: uzak yayınları tarayıcıya aktarır ve HLS playlist'lerini yeniden yazar."""
import re
import urllib.parse
from typing import Any, Optional

from starlette.responses import JSONResponse, Response, StreamingResponse

from core.i18n import t
from services.header_store import get_headers
from services.hls import MAX_PLAYLIST_BYTES, is_hls_content_type

BROWSER_HEADERS = {
    "Accept": "*/*",
}


async def _aclose(response: Any) -> None:
    """Yanıtı kapatır; yoksa ya da zaten kapalıysa sessizce döner."""
    if response is None:
        return
    try:
        await response.aclose()
    except Exception:
        pass


async def _read_limited(response: Any, limit: int) -> bytes:
    """Yanıt gövdesini en fazla ``limit`` bayt okuyup döndürür.

    Playlist sanılan (`.txt` gibi) adresler çok büyük gövde döndürebilir;
    sınırsız `aread()` sunucu belleğini tek istekte şişirir.
    """
    chunks: list[bytes] = []
    size = 0
    async for chunk in response.aiter_bytes():
        if not chunk:
            continue
        remaining = limit - size
        if remaining <= 0:
            break
        part = chunk[:remaining]
        chunks.append(part)
        size += len(part)
    return b"".join(chunks)


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

    `.txt` uzantısı da kabul edilir: bazı CDN'ler HLS playlist'ini düz metin
    olarak sunar ve `#EXTM3U` kontrolü gövde okunduktan sonra yapılır.
    """
    return parsed.path.lower().rstrip("/").endswith((".m3u8", ".m3u", ".txt"))


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
    # Tüm key'ler lowercase normalize edilir; böylece token'dan gelen "Referer"
    # ile aşağıda set edilen "referer" çakışıp httpx'e çift başlık gitmiyor.
    token = request.query_params.get("t")
    custom_headers = {k.lower(): v for k, v in get_headers(token).items()}

    headers = dict(BROWSER_HEADERS)
    headers["user-agent"] = request.app.state.user_agent
    if "range" in request.headers:
        headers["range"] = request.headers["range"]
    # Token'dan explicit Referer geliyorsa CDN host'tan türetileni yazma.
    if "referer" not in custom_headers:
        headers["referer"] = f"{parsed.scheme}://{parsed.netloc}/"
    headers.update(custom_headers)
    # Range her zaman tarayıcıdan gelen aralıktır (kaynak başlığı olamaz).
    if "range" in request.headers:
        headers["range"] = request.headers["range"]

    upstream = None
    try:
        # Segment ve doğrudan dosyalar: bayt bayt, range desteğiyle akıt.
        # Playlist olup olmadığı URL uzantısından değil, yanıtın kendisinden
        # anlaşılır: CDN'ler master/media playlist'i `.m3u8` olmadan sunabiliyor.
        upstream = await http.send(
            http.build_request("GET", target_url, headers=headers),
            stream=True,
        )
        content_type = upstream.headers.get("content-type", "")

        if _is_playlist(parsed) or is_hls_content_type(content_type):
            # Playlist'ler küçüktür: gövde tamamen okunup URI'ler proxy'ye
            # çevrilir. `aread()` sıkıştırmayı çözer; yeni gövde farklı
            # uzunlukta olabileceği için upstream `Content-Length` kullanılmaz.
            # `.txt` uzantılı adresler de playlist sayıldığından gövde boyutu
            # sınırlanır: bozuk bir CDN gigabaytlarca metin gönderirse sunucu
            # belleği şişmemeli.
            try:
                body = await _read_limited(upstream, MAX_PLAYLIST_BYTES)
            finally:
                await _aclose(upstream)
            text = body.decode("utf-8", errors="replace")

            if "#EXTM3U" in text:
                rewritten = _rewrite_playlist(text, str(upstream.url), token)
                return Response(
                    content=rewritten.encode("utf-8"),
                    media_type="application/vnd.apple.mpegurl",
                    headers={"Access-Control-Allow-Origin": "*"},
                )

            return Response(
                content=body,
                status_code=upstream.status_code,
                media_type=content_type or "application/octet-stream",
                headers={"Access-Control-Allow-Origin": "*"},
            )

        response_headers = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
            "Accept-Ranges": "bytes",
        }
        # `aiter_raw()` sıkıştırılmış baytları olduğu gibi aktarır; bu sayede
        # `Content-Length`/`Content-Encoding` başlıkları gövdeyle tutarlı kalır.
        if "content-encoding" in upstream.headers:
            response_headers["Content-Encoding"] = upstream.headers["content-encoding"]
        if "content-length" in upstream.headers:
            response_headers["Content-Length"] = upstream.headers["content-length"]
        if "content-range" in upstream.headers:
            response_headers["Content-Range"] = upstream.headers["content-range"]

        async def stream_body():
            try:
                async for chunk in upstream.aiter_raw(chunk_size=65536):
                    yield chunk
            finally:
                await _aclose(upstream)

        return StreamingResponse(
            stream_body(),
            status_code=upstream.status_code,
            media_type=upstream.headers.get("content-type", "video/mp2t"),
            headers=response_headers,
        )
    except Exception as exc:
        # Yanıt açıldıktan sonra oluşan hatalarda bağlantı kapatılmazsa
        # httpx havuzunda soket + okuma tamponu açık kalır; HLS oynatırken
        # her kopan segment isteği kalıcı bir sızıntı bırakıyordu.
        await _aclose(upstream)
        return JSONResponse({"error": t("error.proxyFailed", detail=exc)}, status_code=502)
