"""Uzantısız HLS playlist'lerinin tespiti ve doğrudan kaynak çözümlemesi."""
import sys
import unittest
from pathlib import Path
from typing import Optional

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.hls import detect_hls, is_hls_content_type, quality_height  # noqa: E402
from services.resolver import _resolve_direct  # noqa: E402

URL = "https://cdn.example.com/mc/extensionless-playlist"

MASTER_PLAYLIST = """#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio0",NAME="Türkçe",URI="/audio/tr"
#EXT-X-STREAM-INF:BANDWIDTH=2102974,RESOLUTION=1920x1080,AUDIO="audio0"
/video/1080
#EXT-X-STREAM-INF:BANDWIDTH=1392003,RESOLUTION=1280x720,AUDIO="audio0"
/video/720
"""

MEDIA_PLAYLIST = """#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6,
/segment/0.ts
"""

CROPPED_MASTER = """#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1920x800
/video/1920x800
#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x532
/video/1280x532
#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=854x354
/video/854x354
#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x266
/video/640x266
"""


class FakeResponse:
    def __init__(
        self,
        *,
        status_code: int = 200,
        headers: Optional[dict[str, str]] = None,
        body: bytes = b"",
        url: str = URL,
    ) -> None:
        self.status_code = status_code
        self.headers = headers or {}
        self.content = body
        self.text = body.decode("utf-8", errors="ignore")
        self.url = url

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    async def aiter_bytes(self):
        yield self.content


class FakeStream:
    def __init__(self, response: FakeResponse) -> None:
        self.response = response

    async def __aenter__(self) -> FakeResponse:
        return self.response

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def aiter_bytes(self):
        yield self.response.content


class FakeClient:
    def __init__(
        self,
        *,
        head_type: str,
        body: bytes,
        head_status: int = 200,
        get_body: Optional[bytes] = None,
    ) -> None:
        self.head_type = head_type
        self.body = body
        self.head_status = head_status
        self.get_body = get_body if get_body is not None else body
        self.head_calls = 0
        self.get_calls = 0
        self.stream_calls = 0

    async def head(self, url: str, headers=None) -> FakeResponse:
        self.head_calls += 1
        return FakeResponse(
            status_code=self.head_status,
            headers={"content-type": self.head_type},
        )

    async def get(self, url: str, headers=None) -> FakeResponse:
        self.get_calls += 1
        return FakeResponse(body=self.get_body)

    def stream(self, method: str, url: str, headers=None) -> FakeStream:
        self.stream_calls += 1
        return FakeStream(
            FakeResponse(headers={"content-type": self.head_type}, body=self.body)
        )


class HlsContentTypeTests(unittest.TestCase):
    def test_mpegurl_types_are_detected_case_insensitively(self):
        self.assertTrue(is_hls_content_type("application/x-mpegURL"))
        self.assertTrue(is_hls_content_type("application/vnd.apple.mpegurl; charset=utf-8"))
        self.assertFalse(is_hls_content_type("video/mp4"))
        self.assertFalse(is_hls_content_type(None))


class HlsDetectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_extensionless_playlist_is_detected_from_content_type(self):
        client = FakeClient(head_type="application/x-mpegURL", body=b"#EXTM3U\n")
        self.assertTrue(await detect_hls(client, URL))

    async def test_playlist_is_detected_from_first_bytes_as_fallback(self):
        client = FakeClient(
            head_type="application/octet-stream",
            body=b"\xef\xbb\xbf  #EXTM3U\n#EXT-X-VERSION:3\n",
        )
        self.assertTrue(await detect_hls(client, URL))
        self.assertEqual(client.stream_calls, 1)

    async def test_direct_media_is_not_treated_as_hls(self):
        client = FakeClient(head_type="video/mp4", body=b"\x00\x00\x00\x18ftypmp42")
        self.assertFalse(await detect_hls(client, URL))

    async def test_m3u8_suffix_skips_network_probe(self):
        class FailingClient:
            async def head(self, *args, **kwargs):
                raise AssertionError("ağ isteği yapılmamalıydı")

        self.assertTrue(await detect_hls(FailingClient(), f"{URL}.m3u8"))


class ExtensionlessResolveTests(unittest.IsolatedAsyncioTestCase):
    async def test_master_playlist_returns_variants_and_hls_flag(self):
        client = FakeClient(
            head_type="application/x-mpegURL",
            body=MASTER_PLAYLIST.encode(),
        )
        result = await _resolve_direct(URL, client)

        self.assertTrue(result["is_m3u8"])
        self.assertEqual(len(result["variants"]), 2)
        self.assertEqual(result["variants"][0]["height"], 1080)
        self.assertTrue(result["variants"][0]["hls"])
        self.assertTrue(result["variants"][0]["default"])
        self.assertEqual(result["variants"][0]["audio_url"], "https://cdn.example.com/audio/tr")
        self.assertTrue(result["variants"][0]["audio_hls"])
        self.assertEqual(result["audio_url"], "https://cdn.example.com/audio/tr")
        self.assertFalse(result["has_audio"])
        self.assertEqual(result["stream_url"], "https://cdn.example.com/video/1080")

    async def test_media_playlist_is_marked_hls_without_variants(self):
        client = FakeClient(
            head_type="application/x-mpegURL",
            body=MEDIA_PLAYLIST.encode(),
        )
        result = await _resolve_direct(URL, client)

        self.assertTrue(result["is_m3u8"])
        self.assertEqual(result["variants"], [])
        self.assertEqual(result["stream_url"], URL)

    async def test_direct_mp4_is_not_downloaded_for_detection(self):
        client = FakeClient(head_type="video/mp4", body=b"\x00" * 4096)
        result = await _resolve_direct(URL, client)

        self.assertFalse(result["is_m3u8"])
        self.assertEqual(result["variants"], [])
        self.assertEqual(client.get_calls, 0)

    async def test_master_playlist_detected_by_body_when_head_type_is_generic(self):
        client = FakeClient(
            head_type="application/octet-stream",
            body=MASTER_PLAYLIST.encode(),
        )
        result = await _resolve_direct(URL, client)

        self.assertTrue(result["is_m3u8"])
        self.assertEqual(len(result["variants"]), 2)


class HlsQualityLabelTests(unittest.TestCase):
    def test_cropped_1080p_is_labelled_by_width(self):
        self.assertEqual(quality_height(1920, 800), 1080)
        self.assertEqual(quality_height(1280, 532), 720)
        self.assertEqual(quality_height(854, 354), 480)
        self.assertEqual(quality_height(640, 266), 360)

    def test_standard_resolutions_keep_their_height(self):
        self.assertEqual(quality_height(1920, 1080), 1080)
        self.assertEqual(quality_height(1280, 720), 720)
        self.assertEqual(quality_height(1024, 576), 576)
        self.assertEqual(quality_height(1600, 900), 900)

    def test_portrait_video_uses_short_side(self):
        self.assertEqual(quality_height(1080, 1920), 1080)
        self.assertEqual(quality_height(720, 1280), 720)


class CroppedVariantResolveTests(unittest.IsolatedAsyncioTestCase):
    async def test_preview_labels_reflect_broadcast_ladder(self):
        client = FakeClient(
            head_type="application/x-mpegURL",
            body=CROPPED_MASTER.encode(),
        )
        result = await _resolve_direct(URL, client)

        self.assertEqual(result["resolution"], "1080p")
        self.assertEqual(
            [item["label"] for item in result["variants"]],
            ["1080p", "720p", "480p", "360p"],
        )
        # Ham piksel yüksekliği korunur; etiket kalite sınıfını gösterir.
        self.assertEqual(
            [item["height"] for item in result["variants"]],
            [800, 532, 354, 266],
        )
        self.assertTrue(result["variants"][0]["default"])


if __name__ == "__main__":
    unittest.main()
