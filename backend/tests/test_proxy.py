"""CORS proxy'sinin uzantısız HLS playlist'lerini ve sıkıştırılmış yanıtları aktarımı."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Optional

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.proxy import proxy_request  # noqa: E402

URL = "https://cdn.example.com/mc/extensionless-playlist"

MASTER_PLAYLIST = b"""#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio0",NAME="Turkish",DEFAULT=YES,URI="/audio/tr"
#EXT-X-STREAM-INF:BANDWIDTH=2102974,RESOLUTION=1920x1080,AUDIO="audio0"
/video/1080
#EXT-X-STREAM-INF:BANDWIDTH=1392003,RESOLUTION=1280x720,AUDIO="audio0"
/video/720
"""

MEDIA_PLAYLIST = b"""#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MAP:URI="/init/0.mp4"
#EXTINF:6,
/segment/0.ts
"""


class FakeUpstream:
    def __init__(
        self,
        body: bytes,
        *,
        headers: Optional[dict[str, str]] = None,
        status_code: int = 200,
        url: str = URL,
    ) -> None:
        self.body = body
        self.headers = headers or {}
        self.status_code = status_code
        self.url = url
        self.closed = False

    async def aread(self) -> bytes:
        return self.body

    async def aiter_raw(self, chunk_size: int = 65536):
        for start in range(0, len(self.body), max(1, chunk_size)):
            yield self.body[start:start + chunk_size]

    async def aclose(self) -> None:
        self.closed = True


class FakeHttp:
    def __init__(self, upstream: FakeUpstream) -> None:
        self.upstream = upstream
        self.request_url: Optional[str] = None

    def build_request(self, method: str, url: str, headers=None):
        self.request_url = url
        return {"method": method, "url": url, "headers": headers}

    async def send(self, request, stream: bool = False):
        return self.upstream


class FakeRequest:
    def __init__(self, upstream: FakeUpstream, url: str = URL) -> None:
        self.query_params = {"url": url}
        self.headers = {}
        self.app = SimpleNamespace(
            state=SimpleNamespace(http=FakeHttp(upstream), user_agent="test-agent")
        )


async def _read_body(response) -> bytes:
    if hasattr(response, "body"):
        return response.body
    chunks = []
    async for chunk in response.body_iterator:
        chunks.append(chunk if isinstance(chunk, bytes) else str(chunk).encode())
    return b"".join(chunks)


class ExtensionlessPlaylistProxyTests(unittest.IsolatedAsyncioTestCase):
    async def test_master_playlist_is_rewritten_even_without_m3u8_suffix(self):
        upstream = FakeUpstream(
            MASTER_PLAYLIST,
            headers={"content-type": "application/x-mpegURL"},
        )
        response = await proxy_request(FakeRequest(upstream))

        body = (await _read_body(response)).decode()
        self.assertEqual(response.media_type, "application/vnd.apple.mpegurl")
        # Varyant ve ses rendition adresleri proxy üzerinden geçmeli.
        self.assertIn("/api/media/proxy?url=", body)
        self.assertNotIn("\n/video/1080", body)
        self.assertNotIn('URI="/audio/tr"', body)
        self.assertIn("https%3A%2F%2Fcdn.example.com%2Fvideo%2F1080", body)
        self.assertIn("https%3A%2F%2Fcdn.example.com%2Faudio%2Ftr", body)

    async def test_media_playlist_segments_and_init_map_are_rewritten(self):
        upstream = FakeUpstream(
            MEDIA_PLAYLIST,
            headers={"content-type": "application/vnd.apple.mpegurl; charset=utf-8"},
        )
        response = await proxy_request(FakeRequest(upstream))

        body = (await _read_body(response)).decode()
        self.assertIn("https%3A%2F%2Fcdn.example.com%2Finit%2F0.mp4", body)
        self.assertIn("https%3A%2F%2Fcdn.example.com%2Fsegment%2F0.ts", body)

    async def test_playlist_ignores_upstream_content_length_after_decompression(self):
        # CDN `Content-Length` olarak sıkıştırılmış boyutu bildirir; gövde
        # açıldıktan sonra eski başlık kullanılırsa bağlantı kırılır.
        upstream = FakeUpstream(
            MASTER_PLAYLIST * 50,
            headers={
                "content-type": "application/x-mpegURL",
                "content-encoding": "gzip",
                "content-length": "42",
            },
        )
        response = await proxy_request(FakeRequest(upstream))

        body = await _read_body(response)
        self.assertNotEqual(response.headers.get("content-length"), "42")
        self.assertEqual(int(response.headers["content-length"]), len(body))


class SegmentProxyTests(unittest.IsolatedAsyncioTestCase):
    async def test_encoded_segment_forwards_raw_bytes_and_headers(self):
        raw = b"0123456789" * 100
        upstream = FakeUpstream(
            raw,
            headers={
                "content-type": "video/mp2t",
                "content-encoding": "gzip",
                "content-length": str(len(raw)),
                "content-range": f"bytes 0-{len(raw) - 1}/{len(raw)}",
            },
        )
        response = await proxy_request(FakeRequest(upstream, f"{URL}-seg.ts"))

        body = await _read_body(response)
        self.assertEqual(body, raw)
        self.assertEqual(response.headers["content-encoding"], "gzip")
        self.assertEqual(response.headers["content-length"], str(len(raw)))
        self.assertEqual(
            response.headers["content-range"], f"bytes 0-{len(raw) - 1}/{len(raw)}"
        )

    async def test_range_header_is_forwarded_to_upstream(self):
        upstream = FakeUpstream(
            b"segment",
            headers={"content-type": "video/mp2t", "content-length": "7"},
        )
        request = FakeRequest(upstream, f"{URL}-seg.ts")
        request.headers = {"range": "bytes=0-6"}
        http = request.app.state.http
        await proxy_request(request)

        self.assertEqual(http.request_url, f"{URL}-seg.ts")


if __name__ == "__main__":
    unittest.main()
