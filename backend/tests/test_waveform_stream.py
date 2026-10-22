"""Kademeli waveform akışı: NDJSON olayları, önbellek ve sessiz kaynak."""
import base64
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.segment_downloader import (  # noqa: E402
    DownloadedChunk,
    HlsDownloadError,
    MediaPlaylist,
    MediaSegment,
)
from services.waveform import NoAudioError, stream_waveform  # noqa: E402


async def collect(events) -> list[dict]:
    return [event async for event in events]


class StreamingWaveformTests(unittest.IsolatedAsyncioTestCase):
    async def test_hls_stream_emits_start_chunks_and_done(self):
        playlist = MediaPlaylist(
            segments=[MediaSegment("one", 300.0), MediaSegment("two", 300.0)],
            duration=600.0,
            endlist=True,
        )
        downloaded = [
            DownloadedChunk(0, Path("chunk-0.bin"), 0.0, 300.0, 1),
            DownloadedChunk(1, Path("chunk-1.bin"), 300.0, 300.0, 1),
        ]

        async def fake_chunks(*args, **kwargs):
            for chunk in downloaded:
                yield chunk

        peaks = [
            {0: 100, 1: 200},
            {2398: 300, 2399: 400},
        ]
        write_cache = Mock()

        with (
            patch("services.waveform._read_cache", return_value=None),
            patch("services.waveform._write_cache", write_cache),
            patch(
                "services.waveform.load_hls_playlist",
                new=AsyncMock(return_value=playlist),
            ),
            patch("services.waveform.iter_hls_chunks", new=fake_chunks),
            patch(
                "services.waveform._peaks_for_range",
                new=AsyncMock(side_effect=peaks),
            ),
        ):
            events = await collect(
                stream_waveform(
                    "https://example.com/media",
                    duration=600.0,
                    audio_url="https://example.com/audio.m3u8",
                    client=object(),
                )
            )

        self.assertEqual(
            [event["type"] for event in events],
            ["start", "chunk", "chunk", "done"],
        )
        self.assertEqual(events[0]["bucket_count"], 2400)
        self.assertEqual(events[1]["start"], 0)
        self.assertEqual(events[1]["count"], 2)
        self.assertEqual(events[2]["start"], 2398)
        self.assertEqual(events[2]["count"], 2)
        self.assertFalse(events[0]["cached"])
        self.assertFalse(events[-1]["cached"])
        self.assertEqual(events[-1]["bucket_count"], 2400)

        write_cache.assert_called_once()
        cached_payload = write_cache.call_args.args[1]
        self.assertEqual(cached_payload["bucket_count"], 2400)
        self.assertEqual(
            len(base64.b64decode(cached_payload["buckets"])),
            2400,
        )

    async def test_cache_hit_streams_full_payload_without_extracting(self):
        payload = {
            "success": True,
            "bucket_seconds": 0.25,
            "bucket_count": 2,
            "duration": 0.5,
            "buckets": base64.b64encode(b"\x01\x02").decode("ascii"),
            "cached": False,
            "optimized": True,
        }

        with (
            patch("services.waveform._read_cache", return_value=payload),
            patch("services.waveform._stream_uncached") as extract,
        ):
            events = await collect(
                stream_waveform(
                    "https://example.com/media",
                    audio_url="https://example.com/audio.m3u8",
                )
            )

        extract.assert_not_called()
        self.assertEqual(
            [event["type"] for event in events],
            ["start", "chunk", "done"],
        )
        self.assertTrue(events[0]["cached"])
        self.assertTrue(events[-1]["cached"])
        self.assertEqual(
            base64.b64decode(events[1]["buckets"]),
            b"\x01\x02",
        )

    async def test_silent_source_emits_silent_start_and_done(self):
        write_cache = Mock()
        with (
            patch("services.waveform._read_cache", return_value=None),
            patch("services.waveform._write_cache", write_cache),
            patch(
                "services.waveform._extract",
                new=AsyncMock(side_effect=NoAudioError("no audio")),
            ),
        ):
            events = await collect(
                stream_waveform(
                    "https://example.com/media",
                    audio_url="https://example.com/audio.m3u8",
                )
            )

        self.assertEqual([event["type"] for event in events], ["start", "done"])
        self.assertTrue(events[0]["silent"])
        self.assertTrue(events[-1]["silent"])
        write_cache.assert_called_once()
        self.assertTrue(write_cache.call_args.args[1]["silent"])

    async def test_chunk_download_failure_before_start_falls_back_to_extract(self):
        playlist = MediaPlaylist(
            segments=[MediaSegment("one", 600.0)],
            duration=600.0,
            endlist=True,
        )

        async def failing_chunks(*args, **kwargs):
            raise HlsDownloadError("boom")
            yield  # pragma: no cover - async generator biçimi için

        write_cache = Mock()
        with (
            patch("services.waveform._read_cache", return_value=None),
            patch("services.waveform._write_cache", write_cache),
            patch(
                "services.waveform.load_hls_playlist",
                new=AsyncMock(return_value=playlist),
            ),
            patch("services.waveform.iter_hls_chunks", new=failing_chunks),
            patch(
                "services.waveform._extract",
                new=AsyncMock(return_value=(bytearray(b"\x09\x08"), 600.0)),
            ) as extract,
        ):
            events = await collect(
                stream_waveform(
                    "https://example.com/media",
                    duration=600.0,
                    audio_url="https://example.com/audio.m3u8",
                    client=object(),
                )
            )

        extract.assert_awaited_once()
        self.assertEqual(
            [event["type"] for event in events],
            ["start", "chunk", "done"],
        )
        self.assertEqual(events[1]["count"], 2)
        write_cache.assert_called_once()


if __name__ == "__main__":
    unittest.main()
