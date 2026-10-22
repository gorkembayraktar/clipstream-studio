"""HLS WebVTT altyazılarının tek bir oynatılabilir metne dönüştürülmesi."""
import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.subtitles import SubtitleError, _format_time, build_webvtt  # noqa: E402

PLAYLIST_URL = "https://cdn.example.com/subs/tr.m3u8"


class FakeResponse:
    def __init__(self, text: str = "", status_code: int = 200, url: str = "") -> None:
        self.text = text
        self.status_code = status_code
        self.url = url

    def raise_for_status(self) -> None:
        if self.status_code < 400:
            return
        error = RuntimeError(f"HTTP {self.status_code}")
        error.response = self  # type: ignore[attr-defined]
        raise error


class FakeClient:
    def __init__(self, routes: dict[str, FakeResponse]) -> None:
        self.routes = routes
        self.requests: list[str] = []

    async def get(self, url: str, headers=None) -> FakeResponse:
        self.requests.append(url)
        return self.routes.get(url, FakeResponse(status_code=404, url=url))


class SubtitleExtractionTests(unittest.IsolatedAsyncioTestCase):
    def test_time_format_rolls_over_minutes_and_hours(self):
        self.assertEqual(_format_time(59.9996), "00:01:00.000")
        self.assertEqual(_format_time(3599.9996), "01:00:00.000")

    async def test_direct_webvtt_is_returned_unchanged(self):
        text = "WEBVTT\n\n00:00.000 --> 00:01.000\nMerhaba\n"
        client = FakeClient(
            {"https://cdn.example.com/subs/direct.vtt": FakeResponse(text)}
        )

        result = await build_webvtt(client, "https://cdn.example.com/subs/direct.vtt")

        self.assertTrue(result.startswith("WEBVTT"))
        self.assertIn("Merhaba", result)

    async def test_hls_segments_are_joined_with_media_timestamps(self):
        playlist = """#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6,
seg-0.vtt
#EXTINF:6,
seg-1.vtt
#EXT-X-ENDLIST
"""
        first = """WEBVTT
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0

00:00:01.000 --> 00:00:02.000
Birinci
"""
        second = """WEBVTT
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:540000

00:00:01.000 --> 00:00:02.000
İkinci
"""
        client = FakeClient(
            {
                PLAYLIST_URL: FakeResponse(playlist, url=PLAYLIST_URL),
                "https://cdn.example.com/subs/seg-0.vtt": FakeResponse(first),
                "https://cdn.example.com/subs/seg-1.vtt": FakeResponse(second),
            }
        )

        result = await build_webvtt(client, PLAYLIST_URL)

        self.assertTrue(result.startswith("WEBVTT\n\n"))
        self.assertIn("00:00:01.000 --> 00:00:02.000", result)
        self.assertIn("00:00:07.000 --> 00:00:08.000", result)
        self.assertIn("Birinci", result)
        self.assertIn("İkinci", result)
        self.assertEqual(result.count("WEBVTT"), 1)

    async def test_relative_segment_timestamps_are_shifted(self):
        playlist = """#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6,
seg-0.vtt
#EXTINF:6,
seg-1.vtt
#EXT-X-ENDLIST
"""
        first = "WEBVTT\n\n00:00.500 --> 00:01.000\nBir\n"
        second = "WEBVTT\n\n00:00.500 --> 00:01.000\nİki\n"
        client = FakeClient(
            {
                PLAYLIST_URL: FakeResponse(playlist, url=PLAYLIST_URL),
                "https://cdn.example.com/subs/seg-0.vtt": FakeResponse(first),
                "https://cdn.example.com/subs/seg-1.vtt": FakeResponse(second),
            }
        )

        result = await build_webvtt(client, PLAYLIST_URL)

        self.assertIn("00:00.500 --> 00:01.000", result)
        self.assertIn("00:00:06.500 --> 00:00:07.000", result)

    async def test_forbidden_playlist_reports_actionable_error(self):
        client = FakeClient(
            {PLAYLIST_URL: FakeResponse(status_code=403, url=PLAYLIST_URL)}
        )

        with self.assertRaises(SubtitleError) as context:
            await build_webvtt(client, PLAYLIST_URL)

        self.assertEqual(context.exception.status_code, 403)
        self.assertIn("403", str(context.exception))

    async def test_non_webvtt_payload_is_rejected(self):
        client = FakeClient(
            {PLAYLIST_URL: FakeResponse("<html>not subtitles</html>", url=PLAYLIST_URL)}
        )

        with self.assertRaises(SubtitleError) as context:
            await build_webvtt(client, PLAYLIST_URL)

        self.assertEqual(context.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
