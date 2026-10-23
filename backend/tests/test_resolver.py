"""TikTok URL/platform seçimi ve canlı akış tercihleri."""
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services import resolver  # noqa: E402
from services.resolver import _pick_tiktok_stream, platform_of  # noqa: E402


class TikTokPlatformTests(unittest.TestCase):
    def test_tiktok_hosts_are_detected(self):
        for url in (
            "https://www.tiktok.com/@user/video/123",
            "https://vt.tiktok.com/ZS123/",
            "https://vm.tiktok.com/ZM123/",
            "https://m.tiktok.com/share/live/123",
            "tiktok.com/@user/live",
        ):
            with self.subTest(url=url):
                self.assertEqual(platform_of(url), "tiktok")

    def test_other_platforms_are_unchanged(self):
        self.assertEqual(platform_of("https://youtu.be/abc"), "youtube")
        self.assertEqual(platform_of("https://x.com/user/status/1"), "twitter")
        self.assertEqual(platform_of("https://instagram.com/p/abc"), "instagram")
        self.assertEqual(platform_of("https://cdn.example.com/video.mp4"), "direct")


class TikTokStreamTests(unittest.TestCase):
    def test_live_prefers_muxed_hls_over_flv(self):
        formats = [
            {
                "url": "https://cdn.example.com/live.flv",
                "ext": "flv",
                "vcodec": "h264",
                "acodec": "aac",
                "height": 1080,
            },
            {
                "url": "https://cdn.example.com/live-720.m3u8",
                "ext": "mp4",
                "protocol": "m3u8_native",
                "vcodec": "h264",
                "height": 720,
            },
            {
                "url": "https://cdn.example.com/live-1080.m3u8",
                "ext": "mp4",
                "protocol": "m3u8_native",
                "vcodec": "h264",
                "height": 1080,
            },
        ]

        picked = _pick_tiktok_stream(formats, live=True)

        self.assertIsNotNone(picked)
        self.assertTrue(picked["hls"])
        self.assertEqual(picked["url"], "https://cdn.example.com/live-1080.m3u8")
        self.assertTrue(picked["has_audio"])

    def test_live_falls_back_to_flv_when_hls_is_missing(self):
        picked = _pick_tiktok_stream(
            [
                {
                    "url": "https://cdn.example.com/live.flv",
                    "ext": "flv",
                    "vcodec": "h264",
                    "acodec": "aac",
                }
            ],
            live=True,
        )

        self.assertIsNotNone(picked)
        self.assertFalse(picked["hls"])
        self.assertEqual(picked["url"], "https://cdn.example.com/live.flv")

    def test_regular_video_uses_progressive_mp4(self):
        picked = _pick_tiktok_stream(
            [
                {
                    "url": "https://cdn.example.com/video.mp4",
                    "ext": "mp4",
                    "vcodec": "h264",
                    "acodec": "aac",
                    "height": 720,
                }
            ],
            live=False,
        )

        self.assertIsNotNone(picked)
        self.assertFalse(picked["hls"])
        self.assertEqual(picked["url"], "https://cdn.example.com/video.mp4")
        self.assertTrue(picked["has_audio"])


class FakeProcess:
    returncode = 0

    def __init__(self, payload: dict) -> None:
        self.payload = payload

    async def communicate(self):
        return json.dumps(self.payload).encode("utf-8"), b""


class TikTokResolvePayloadTests(unittest.IsolatedAsyncioTestCase):
    async def test_live_resolve_returns_live_hls_payload(self):
        payload = {
            "title": "Test live",
            "is_live": True,
            "live_status": "is_live",
            "formats": [
                {
                    "url": "https://cdn.example.com/live.flv",
                    "ext": "flv",
                    "vcodec": "h264",
                    "acodec": "aac",
                    "height": 720,
                },
                {
                    "url": "https://cdn.example.com/live.m3u8",
                    "ext": "mp4",
                    "protocol": "m3u8_native",
                    "vcodec": "h264",
                    "height": 720,
                },
            ],
        }
        with patch.object(resolver, "find_ytdlp_command", return_value=["yt-dlp"]):
            with patch.object(
                resolver.asyncio,
                "create_subprocess_exec",
                return_value=FakeProcess(payload),
            ):
                result = await resolver.resolve_url(
                    "https://www.tiktok.com/@user/live"
                )

        self.assertEqual(result["platform"], "tiktok")
        self.assertTrue(result["is_tiktok"])
        self.assertTrue(result["is_live"])
        self.assertEqual(result["live_status"], "is_live")
        self.assertTrue(result["is_m3u8"])
        self.assertEqual(result["stream_url"], "https://cdn.example.com/live.m3u8")
        self.assertEqual(result["http_headers"]["Referer"], "https://www.tiktok.com/")


if __name__ == "__main__":
    unittest.main()
