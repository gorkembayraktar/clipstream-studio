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
from services.resolver import (  # noqa: E402
    ResolveError,
    _audio_track_label,
    _generic_variants,
    _lookup_tiktok_live_room,
    _pick_audio,
    _pick_generic_stream,
    _pick_tiktok_stream,
    _tiktok_live_uploader,
    _tiktok_live_variants,
    _ytdlp_audio_tracks,
    looks_like_media_url,
    platform_of,
)


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

    def test_live_uploader_is_extracted_only_from_live_path(self):
        self.assertEqual(
            _tiktok_live_uploader("https://www.tiktok.com/@testuser/live"),
            "testuser",
        )
        self.assertIsNone(
            _tiktok_live_uploader("https://www.tiktok.com/@testuser/video/123")
        )
        self.assertIsNone(_tiktok_live_uploader("https://m.tiktok.com/share/live/123"))


class FakeResponse:
    def __init__(self, payload: dict) -> None:
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self) -> bytes:
        return json.dumps(self.payload).encode("utf-8")


class TikTokLiveLookupTests(unittest.TestCase):
    def test_live_room_id_is_returned_when_status_is_two(self):
        payload = {
            "data": {
                "user": {"roomId": "7699840766693657351"},
                "liveRoom": {"status": 2},
            }
        }
        with patch.object(
            resolver.urllib.request, "urlopen", return_value=FakeResponse(payload)
        ):
            room_id = _lookup_tiktok_live_room(
                "testuser", "https://www.tiktok.com/@testuser/live"
            )

        self.assertEqual(room_id, "7699840766693657351")

    def test_closed_room_raises_offline_error(self):
        payload = {
            "data": {
                "user": {"roomId": "123"},
                "liveRoom": {"status": 4},
            }
        }
        with patch.object(
            resolver.urllib.request, "urlopen", return_value=FakeResponse(payload)
        ):
            with self.assertRaises(ResolveError):
                _lookup_tiktok_live_room(
                    "testuser", "https://www.tiktok.com/@testuser/live"
                )

    def test_api_failure_falls_back_to_ytdlp(self):
        with patch.object(
            resolver.urllib.request, "urlopen", side_effect=OSError("blocked")
        ):
            self.assertIsNone(
                _lookup_tiktok_live_room(
                    "testuser", "https://www.tiktok.com/@testuser/live"
                )
            )


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

    def test_live_variants_list_all_available_hls_qualities(self):
        formats = [
            {
                "url": "https://cdn.example.com/live-720.m3u8",
                "ext": "mp4",
                "protocol": "m3u8_native",
                "vcodec": "h264",
                "height": 720,
                "tbr": 1800,
            },
            {
                "url": "https://cdn.example.com/live-1080.m3u8",
                "ext": "mp4",
                "protocol": "m3u8_native",
                "vcodec": "h264",
                "height": 1080,
                "tbr": 3000,
            },
            # yt-dlp aynı URL'yi çözünürlük bilgisi olmadan tekrar edebilir.
            {
                "url": "https://cdn.example.com/live-720.m3u8",
                "ext": "mp4",
                "protocol": "m3u8_native",
                "vcodec": "h264",
            },
        ]

        variants = _tiktok_live_variants(formats)

        self.assertEqual([variant["label"] for variant in variants], ["1080p", "720p"])
        self.assertEqual(
            [variant["url"] for variant in variants],
            [
                "https://cdn.example.com/live-1080.m3u8",
                "https://cdn.example.com/live-720.m3u8",
            ],
        )
        self.assertTrue(all(variant["hls"] for variant in variants))
        self.assertTrue(all(variant["has_audio"] for variant in variants))

    def test_live_variants_are_empty_without_hls(self):
        self.assertEqual(
            _tiktok_live_variants(
                [
                    {
                        "url": "https://cdn.example.com/live.flv",
                        "ext": "flv",
                        "vcodec": "h264",
                    }
                ]
            ),
            [],
        )

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
        captured: dict[str, tuple] = {}

        async def fake_exec(*args, **kwargs):
            captured["args"] = args
            return FakeProcess(payload)

        with patch.object(resolver, "find_ytdlp_command", return_value=["yt-dlp"]):
            with patch.object(
                resolver, "_lookup_tiktok_live_room", return_value="7699840766693657351"
            ):
                with patch.object(
                    resolver.asyncio,
                    "create_subprocess_exec",
                    side_effect=fake_exec,
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
        self.assertIn(
            "https://m.tiktok.com/share/live/7699840766693657351/",
            captured["args"],
        )


class GenericSiteResolveTests(unittest.IsolatedAsyncioTestCase):
    """yt-dlp'nin tanıdığı diğer siteler de çözülür (yalnızca 4 platform değil)."""

    def test_media_urls_are_detected_by_extension(self):
        self.assertTrue(looks_like_media_url("https://cdn.example.com/video.mp4"))
        self.assertTrue(
            looks_like_media_url("https://cdn.example.com/live.m3u8?token=1")
        )
        self.assertFalse(looks_like_media_url("https://vimeo.com/76979871"))
        self.assertFalse(looks_like_media_url("https://example.com/watch?v=1"))
        self.assertEqual(platform_of("https://vimeo.com/76979871"), "direct")

    def test_codec_less_formats_pick_browser_playable_stream(self):
        formats = [
            {"url": "https://cdn.example.com/a.ogv", "ext": "ogv", "height": 300},
            {"url": "https://cdn.example.com/a.avi", "ext": "avi", "height": 720},
            {"url": "https://cdn.example.com/a.mp4", "ext": "mp4", "height": 360},
        ]

        picked = _pick_generic_stream(formats)

        self.assertIsNotNone(picked)
        self.assertEqual(picked["url"], "https://cdn.example.com/a.mp4")
        self.assertTrue(picked["has_audio"])

    def test_generic_hls_variants_are_listed(self):
        formats = [
            {
                "url": "https://cdn.example.com/hls/720.m3u8",
                "ext": "mp4",
                "protocol": "m3u8_native",
                "vcodec": "h264",
                "acodec": "aac",
                "height": 720,
            },
            {
                "url": "https://cdn.example.com/hls/360.m3u8",
                "ext": "mp4",
                "protocol": "m3u8_native",
                "vcodec": "h264",
                "acodec": "aac",
                "height": 360,
            },
        ]

        variants = _generic_variants(formats)

        self.assertEqual([variant["height"] for variant in variants], [720, 360])
        self.assertTrue(all(variant["hls"] for variant in variants))

    async def test_media_url_skips_ytdlp(self):
        async def fake_direct(url, client, headers=None):
            return {"platform": "direct", "stream_url": url}

        with patch.object(resolver, "_resolve_direct", side_effect=fake_direct):
            with patch.object(
                resolver, "find_ytdlp_command", side_effect=AssertionError("yt-dlp çağrıldı")
            ):
                result = await resolver.resolve_url(
                    "https://cdn.example.com/video.mp4"
                )

        self.assertEqual(result["platform"], "direct")

    async def test_unknown_site_is_resolved_with_ytdlp(self):
        payload = {
            "title": "Generic site video",
            "formats": [
                {"url": "https://cdn.example.com/a.avi", "ext": "avi", "height": 720},
                {"url": "https://cdn.example.com/a.mp4", "ext": "mp4", "height": 360},
            ],
        }
        captured: dict[str, tuple] = {}

        async def fake_exec(*args, **kwargs):
            captured["args"] = args
            return FakeProcess(payload)

        with patch.object(resolver, "find_ytdlp_command", return_value=["yt-dlp"]):
            with patch.object(
                resolver.asyncio, "create_subprocess_exec", side_effect=fake_exec
            ):
                result = await resolver.resolve_url("https://vimeo.com/76979871")

        self.assertEqual(result["platform"], "ytdlp")
        self.assertFalse(result["is_youtube"])
        self.assertEqual(result["stream_url"], "https://cdn.example.com/a.mp4")
        self.assertTrue(result["has_audio"])
        self.assertIn("https://vimeo.com/76979871", captured["args"])


class YoutubeAudioTrackTests(unittest.TestCase):
    """YouTube dublajlarının dil listesine dönüştürülmesi."""

    @staticmethod
    def audio_format(**overrides):
        base = {
            "format_id": "140",
            "url": "https://rr1.googlevideo.com/videoplayback?itag=140",
            "ext": "m4a",
            "acodec": "mp4a.40.2",
            "vcodec": "none",
            "abr": 129.4,
            "language": "en-US",
            "language_preference": 10,
            "format_note": "English (US) original (default), medium",
            "protocol": "https",
        }
        base.update(overrides)
        return base

    def test_label_keeps_audio_track_name(self):
        self.assertEqual(
            _audio_track_label(self.audio_format()),
            "English (US)",
        )
        self.assertEqual(
            _audio_track_label(self.audio_format(format_note="Turkish, medium")),
            "Turkish",
        )
        self.assertEqual(
            _audio_track_label(self.audio_format(format_note="low, DRC")),
            "",
        )

    def test_dubs_are_deduped_per_language_and_original_is_default(self):
        formats = [
            self.audio_format(),
            self.audio_format(
                format_id="140-3",
                url="https://rr1.googlevideo.com/dub-tr",
                language="tr",
                language_preference=-1,
                format_note="Turkish, medium",
            ),
            self.audio_format(
                format_id="251-7",
                url="https://rr1.googlevideo.com/dub-tr-webm",
                ext="webm",
                acodec="opus",
                abr=128.1,
                language="tr",
                language_preference=-1,
                format_note="Turkish, medium",
            ),
            self.audio_format(
                format_id="139-22",
                url="https://rr1.googlevideo.com/dub-tr-low",
                abr=48.7,
                language="tr",
                language_preference=-1,
                format_note="Turkish, low",
            ),
        ]

        tracks = _ytdlp_audio_tracks(formats)

        self.assertEqual([track["language"] for track in tracks], ["en-US", "tr"])
        self.assertTrue(tracks[0]["original"])
        self.assertFalse(tracks[0]["default"])
        self.assertFalse(tracks[1]["default"])
        # Aynı dilde AAC ve daha yüksek bit hızı seçilir.
        self.assertEqual(tracks[1]["url"], "https://rr1.googlevideo.com/dub-tr")
        self.assertEqual(tracks[1]["name"], "Turkish")
        self.assertEqual(tracks[1]["id"], "yt|tr")
        self.assertTrue(all(track["id"].startswith("yt|") for track in tracks))

    def test_single_language_yields_single_track(self):
        formats = [
            self.audio_format(
                format_id="139-drc",
                abr=48.8,
                format_note="low, DRC",
                url="https://rr1.googlevideo.com/drc",
            ),
            self.audio_format(format_note="medium", abr=129.4),
        ]

        tracks = _ytdlp_audio_tracks(formats)

        self.assertEqual(len(tracks), 1)
        self.assertEqual(tracks[0]["id"], "yt|en-US")
        self.assertTrue(tracks[0]["original"])
        self.assertFalse(tracks[0]["default"])

    def test_channel_default_dub_is_marked_separately(self):
        formats = [
            self.audio_format(),
            self.audio_format(
                format_id="140-9",
                url="https://rr1.googlevideo.com/dub-fr",
                language="fr",
                language_preference=5,
                format_note="French, medium",
            ),
            self.audio_format(
                format_id="140-3",
                url="https://rr1.googlevideo.com/dub-tr",
                language="tr",
                language_preference=-1,
                format_note="Turkish, medium",
            ),
        ]

        tracks = _ytdlp_audio_tracks(formats)

        self.assertEqual(
            [track["id"] for track in tracks],
            ["yt|en-US", "yt|fr", "yt|tr"],
        )
        self.assertTrue(tracks[0]["original"])
        self.assertFalse(tracks[0]["default"])
        self.assertTrue(tracks[1]["default"])
        self.assertFalse(tracks[1]["original"])
        self.assertFalse(tracks[2]["default"])
        self.assertFalse(tracks[2]["original"])

    def test_pick_audio_prefers_original_language_over_dub(self):
        formats = [
            self.audio_format(
                url="https://rr1.googlevideo.com/dub",
                language="tr",
                language_preference=-1,
                abr=129.4,
            ),
            self.audio_format(
                url="https://rr1.googlevideo.com/original",
                ext="webm",
                acodec="opus",
                abr=125.3,
                language_preference=10,
            ),
        ]

        self.assertEqual(
            _pick_audio(formats),
            "https://rr1.googlevideo.com/original",
        )


if __name__ == "__main__":
    unittest.main()
