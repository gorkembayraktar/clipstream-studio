"""Paralel HLS segment indiricisi: sıralı birleştirme ve geçici dosya temizliği."""
import asyncio
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Optional
from unittest.mock import AsyncMock, patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.segment_downloader import (  # noqa: E402
    HlsDownloadError,
    LiveTimelineError,
    MediaSegment,
    _remux_parts_with_ffmpeg,
    download_hls_media,
    download_hls_range,
    download_hls_segments,
    iter_hls_chunks,
    live_timeline_shift,
    load_hls_playlist,
    locate_segment,
    parse_media_playlist,
    segment_offset,
)

PLAYLIST_URL = "https://cdn.example.com/path/media.m3u8"

CHUNKED_PLAYLIST = """#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:20
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="init.mp4"
#EXTINF:20.0,
s1.jpg
#EXTINF:20.0,
s2.jpg
#EXTINF:20.0,
s3.jpg
#EXTINF:20.0,
s4.jpg
#EXTINF:20.0,
s5.jpg
#EXTINF:20.0,
s6.jpg
#EXT-X-ENDLIST
"""

PLAYLIST = """#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:10
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MEDIA-SEQUENCE:1
#EXT-X-MAP:URI="init.mp4"
#EXTINF:4.0,
seg1.jpg
#EXTINF:10.0,
seg2.jpg
#EXTINF:6.0,
seg3.jpg
#EXT-X-ENDLIST
"""

#: 24 saatlik DVR penceresi gibi `ENDLIST` taşımayan kayan canlı playlist.
LIVE_PLAYLIST = """#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:1000
#EXTINF:6.0,
live1000.ts
#EXTINF:6.0,
live1001.ts
#EXTINF:4.0,
live1002.ts
#EXTINF:6.0,
live1003.ts
"""


class FakeResponse:
    def __init__(
        self,
        *,
        status_code: int = 200,
        text: str = "",
        body: bytes = b"",
        url: str = PLAYLIST_URL,
        delay: float = 0.0,
    ) -> None:
        self.status_code = status_code
        self.text = text
        self.url = url
        self.body = body
        self.delay = delay

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    async def aiter_bytes(self):
        if self.delay:
            await asyncio.sleep(self.delay)
        yield self.body


class FakeStream:
    def __init__(self, response: FakeResponse) -> None:
        self.response = response

    async def __aenter__(self) -> FakeResponse:
        return self.response

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None


class FakeClient:
    def __init__(
        self,
        *,
        playlist: str = PLAYLIST,
        bodies: Optional[dict[str, bytes]] = None,
        delays: Optional[dict[str, float]] = None,
        fail_urls: Optional[set[str]] = None,
    ) -> None:
        self.playlist = playlist
        self.bodies = bodies or {}
        self.delays = delays or {}
        self.fail_urls = fail_urls or set()
        self.requests: list[str] = []

    async def get(self, url: str, headers=None) -> FakeResponse:
        self.requests.append(url)
        return FakeResponse(text=self.playlist, url=url)

    def stream(self, method: str, url: str, headers=None, timeout=None) -> FakeStream:
        self.requests.append(url)
        if url in self.fail_urls:
            return FakeStream(FakeResponse(status_code=500, url=url))
        body = self.playlist.encode("utf-8") if url == PLAYLIST_URL else self.bodies.get(url, b"")
        return FakeStream(
            FakeResponse(
                body=body,
                url=url,
                delay=self.delays.get(url, 0.0),
            )
        )


class MediaPlaylistParseTests(unittest.TestCase):
    def test_relative_urls_and_duration_are_resolved(self):
        playlist = parse_media_playlist(PLAYLIST, PLAYLIST_URL)

        self.assertIsNotNone(playlist)
        assert playlist is not None
        self.assertEqual(playlist.duration, 20.0)
        self.assertEqual(
            [segment.url for segment in playlist.segments],
            [
                "https://cdn.example.com/path/seg1.jpg",
                "https://cdn.example.com/path/seg2.jpg",
                "https://cdn.example.com/path/seg3.jpg",
            ],
        )
        self.assertEqual(
            playlist.init_url, "https://cdn.example.com/path/init.mp4"
        )
        self.assertTrue(playlist.endlist)
        self.assertFalse(playlist.encrypted)

    def test_master_playlist_is_not_a_media_playlist(self):
        master = """#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1920x1080
/video/1080
"""
        self.assertIsNone(parse_media_playlist(master, PLAYLIST_URL))

    def test_discontinuity_is_flagged(self):
        text = PLAYLIST.replace(
            "#EXTINF:10.0,", "#EXT-X-DISCONTINUITY\n#EXTINF:10.0,"
        )
        playlist = parse_media_playlist(text, PLAYLIST_URL)

        self.assertIsNotNone(playlist)
        assert playlist is not None
        self.assertTrue(playlist.discontinuity)

    def test_changing_init_map_is_flagged(self):
        text = PLAYLIST.replace(
            '#EXT-X-MAP:URI="init.mp4"',
            '#EXT-X-MAP:URI="init.mp4"\n#EXT-X-MAP:URI="init2.mp4"',
        )
        playlist = parse_media_playlist(text, PLAYLIST_URL)

        self.assertIsNotNone(playlist)
        assert playlist is not None
        self.assertTrue(playlist.discontinuity)
        self.assertEqual(
            playlist.init_url, "https://cdn.example.com/path/init2.mp4"
        )


class StoryboardSegmentTests(unittest.IsolatedAsyncioTestCase):
    def test_locate_segment_returns_index_and_offset(self):
        playlist = parse_media_playlist(PLAYLIST, PLAYLIST_URL)
        assert playlist is not None

        self.assertEqual(locate_segment(playlist, 0.0), (0, 0.0))
        self.assertEqual(locate_segment(playlist, 4.5), (1, 0.5))
        self.assertEqual(locate_segment(playlist, 13.9), (1, 9.9))
        self.assertEqual(locate_segment(playlist, 14.5), (2, 0.5))
        index, offset = locate_segment(playlist, 999.0)
        self.assertEqual(index, 2)
        self.assertAlmostEqual(offset, 5.999, places=3)

    async def test_only_selected_segments_are_downloaded_and_init_is_prepended(self):
        base = "https://cdn.example.com/path/"
        bodies = {
            base + "init.mp4": b"INIT",
            base + "seg1.jpg": b"ONE",
            base + "seg2.jpg": b"TWO",
            base + "seg3.jpg": b"THREE",
        }
        playlist = parse_media_playlist(PLAYLIST, PLAYLIST_URL)
        assert playlist is not None

        with tempfile.TemporaryDirectory() as root:
            temp_root = Path(root)
            download = await download_hls_segments(
                FakeClient(bodies=bodies),
                playlist,
                [0, 2],
                temp_root=temp_root,
            )

            self.assertIsNotNone(download)
            assert download is not None
            self.assertEqual(download.paths[0].read_bytes(), b"INITONE")
            self.assertEqual(download.paths[2].read_bytes(), b"INITTHREE")
            self.assertEqual(download.starts[1], 4.0)
            self.assertEqual(download.durations[2], 6.0)
            self.assertEqual(list(temp_root.iterdir()), [download.temp_dir])

            temp_dir = download.temp_dir
            download.cleanup()
            self.assertFalse(temp_dir.exists())
            self.assertEqual(list(temp_root.iterdir()), [])

    async def test_segment_failure_cleans_temp_and_returns_none(self):
        base = "https://cdn.example.com/path/"
        playlist = parse_media_playlist(PLAYLIST, PLAYLIST_URL)
        assert playlist is not None

        with tempfile.TemporaryDirectory() as root:
            temp_root = Path(root)
            with patch("services.segment_downloader.SEGMENT_RETRIES", 1):
                download = await download_hls_segments(
                    FakeClient(
                        bodies={
                            base + "init.mp4": b"INIT",
                            base + "seg2.jpg": b"TWO",
                        },
                        fail_urls={base + "seg2.jpg"},
                    ),
                    playlist,
                    [1],
                    temp_root=temp_root,
                )

            self.assertIsNone(download)
            self.assertEqual(list(temp_root.iterdir()), [])


class ParallelDownloadTests(unittest.IsolatedAsyncioTestCase):
    async def test_segments_merge_in_order_and_temp_dir_is_removed(self):
        base = "https://cdn.example.com/path/"
        bodies = {
            base + "init.mp4": b"INIT",
            base + "seg1.jpg": b"ONE",
            base + "seg2.jpg": b"TWO",
            base + "seg3.jpg": b"THREE",
        }
        # İlk segment daha geç bitse bile birleştirme sırası playlist sırasıdır.
        delays = {base + "seg1.jpg": 0.05, base + "seg2.jpg": 0.01}
        with tempfile.TemporaryDirectory() as root:
            temp_root = Path(root)
            download = await download_hls_media(
                FakeClient(bodies=bodies, delays=delays),
                PLAYLIST_URL,
                temp_root=temp_root,
            )

            self.assertIsNotNone(download)
            assert download is not None
            self.assertEqual(download.path.read_bytes(), b"INITONETWOTHREE")
            self.assertEqual(download.segment_count, 3)
            self.assertEqual(download.duration, 20.0)
            self.assertTrue(download.temp_dir.exists())
            self.assertEqual(list(temp_root.iterdir()), [download.temp_dir])

            temp_dir = download.temp_dir
            download.cleanup()
            self.assertFalse(temp_dir.exists())
            self.assertEqual(list(temp_root.iterdir()), [])

    async def test_encrypted_playlist_falls_back_without_temp_files(self):
        encrypted = PLAYLIST.replace(
            "#EXT-X-MAP:URI=\"init.mp4\"",
            "#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXT-X-MAP:URI=\"init.mp4\"",
        )
        with tempfile.TemporaryDirectory() as root:
            temp_root = Path(root)
            download = await download_hls_media(
                FakeClient(playlist=encrypted),
                PLAYLIST_URL,
                temp_root=temp_root,
            )
            self.assertIsNone(download)
            self.assertEqual(list(temp_root.iterdir()), [])

    async def test_live_playlist_falls_back(self):
        live = PLAYLIST.replace("#EXT-X-ENDLIST\n", "")
        with tempfile.TemporaryDirectory() as root:
            download = await download_hls_media(
                FakeClient(playlist=live),
                PLAYLIST_URL,
                temp_root=Path(root),
            )
            self.assertIsNone(download)

    async def test_failed_segment_cleans_temp_dir(self):
        failed = "https://cdn.example.com/path/seg2.jpg"
        with tempfile.TemporaryDirectory() as root:
            temp_root = Path(root)
            with patch("services.segment_downloader.SEGMENT_RETRIES", 1):
                download = await download_hls_media(
                    FakeClient(
                        bodies={
                            "https://cdn.example.com/path/init.mp4": b"INIT",
                            "https://cdn.example.com/path/seg1.jpg": b"ONE",
                            "https://cdn.example.com/path/seg2.jpg": b"TWO",
                            "https://cdn.example.com/path/seg3.jpg": b"THREE",
                        },
                        fail_urls={failed},
                    ),
                    PLAYLIST_URL,
                    temp_root=temp_root,
                )

            self.assertIsNone(download)
            self.assertEqual(list(temp_root.iterdir()), [])


class RangeDownloadTests(unittest.IsolatedAsyncioTestCase):
    def _bodies(self) -> dict[str, bytes]:
        base = "https://cdn.example.com/path/"
        return {
            base + "init.mp4": b"INIT",
            **{base + f"s{index}.jpg": f"SEG{index}".encode() for index in range(1, 7)},
        }

    async def test_only_overlapping_segments_are_downloaded(self):
        client = FakeClient(playlist=CHUNKED_PLAYLIST, bodies=self._bodies())
        with tempfile.TemporaryDirectory() as root:
            temp_root = Path(root)
            download = await download_hls_range(
                client,
                PLAYLIST_URL,
                25.0,
                35.0,
                temp_root=temp_root,
            )

            self.assertIsNotNone(download)
            assert download is not None
            # 20-40 sn aralığındaki yalnızca s2 gerekli; s1 ve s3 indirilmemeli.
            self.assertEqual(download.path.read_bytes(), b"INITSEG2")
            self.assertEqual(download.start, 20.0)
            self.assertEqual(download.duration, 20.0)
            self.assertEqual(download.segment_count, 1)
            requested = "\n".join(client.requests)
            self.assertNotIn("s1.jpg", requested)
            self.assertNotIn("s3.jpg", requested)

            temp_dir = download.temp_dir
            download.cleanup()
            self.assertFalse(temp_dir.exists())
            self.assertEqual(list(temp_root.iterdir()), [])

    async def test_range_download_failure_cleans_temp_and_returns_none(self):
        base = "https://cdn.example.com/path/"
        client = FakeClient(
            playlist=CHUNKED_PLAYLIST,
            bodies=self._bodies(),
            fail_urls={base + "s2.jpg"},
        )
        with tempfile.TemporaryDirectory() as root:
            temp_root = Path(root)
            with patch("services.segment_downloader.SEGMENT_RETRIES", 1):
                download = await download_hls_range(
                    client,
                    PLAYLIST_URL,
                    25.0,
                    35.0,
                    temp_root=temp_root,
                )

            self.assertIsNone(download)
            self.assertEqual(list(temp_root.iterdir()), [])

    async def test_discontinuous_playlist_is_not_staged(self):
        playlist = CHUNKED_PLAYLIST.replace(
            "#EXTINF:20.0,", "#EXT-X-DISCONTINUITY\n#EXTINF:20.0,"
        )
        client = FakeClient(playlist=playlist, bodies=self._bodies())
        with tempfile.TemporaryDirectory() as root:
            temp_root = Path(root)
            download = await download_hls_range(
                client,
                PLAYLIST_URL,
                25.0,
                35.0,
                temp_root=temp_root,
            )

            self.assertIsNone(download)
            self.assertEqual(list(temp_root.iterdir()), [])
            self.assertNotIn("s2.jpg", "\n".join(client.requests))

    async def test_direct_media_url_is_not_staged(self):
        client = FakeClient(playlist=CHUNKED_PLAYLIST, bodies=self._bodies())
        with tempfile.TemporaryDirectory() as root:
            download = await download_hls_range(
                client,
                "https://cdn.example.com/path/video.mp4",
                0.0,
                10.0,
                temp_root=Path(root),
            )

            self.assertIsNone(download)
            self.assertEqual(client.requests, [])

    async def test_extensionless_direct_media_is_not_staged(self):
        url = "https://cdn.example.com/path/MTc5Mjg5Njg5NDpZWFdFajdfRFVwWWtZ"
        client = FakeClient(playlist=CHUNKED_PLAYLIST, bodies=self._bodies())
        with tempfile.TemporaryDirectory() as root:
            download = await download_hls_range(
                client,
                url,
                0.0,
                10.0,
                temp_root=Path(root),
            )

        self.assertIsNone(download)
        # Yalnızca kısa HLS tespiti yapılmalı; playlist/segment indirilmemeli.
        self.assertEqual(client.requests, [url])

    async def test_remux_uses_mp4_container_for_vp9_safe_staging(self):
        """VP9/AV1 HLS segmentleri MPEG-TS'e yazılmamalı; video kaybolur."""
        with tempfile.TemporaryDirectory() as root:
            temp_dir = Path(root)
            init = temp_dir / "init.mp4"
            init.write_bytes(b"INIT")
            part = temp_dir / "part-1.bin"
            part.write_bytes(b"SEG")
            merged = temp_dir / "merged.mp4"

            class FakeProcess:
                returncode = 0

                async def communicate(self):
                    merged.write_bytes(b"MP4")
                    return b"", b""

            with patch(
                "services.segment_downloader.asyncio.create_subprocess_exec",
                new=AsyncMock(return_value=FakeProcess()),
            ) as spawn:
                result = await _remux_parts_with_ffmpeg(
                    temp_dir,
                    init,
                    [part],
                    [MediaSegment(url="seg", duration=4.0)],
                )

            self.assertEqual(result, merged)
            command = spawn.await_args.args
            self.assertEqual(command[-3:], ("-f", "mp4", "merged.mp4"))
            self.assertNotIn("mpegts", command)
            self.assertFalse((temp_dir / "local.m3u8").exists())


class ChunkedDownloadTests(unittest.IsolatedAsyncioTestCase):
    def _bodies(self) -> dict[str, bytes]:
        base = "https://cdn.example.com/path/"
        return {
            base + "init.mp4": b"INIT",
            **{base + f"s{index}.jpg": f"SEG{index}".encode() for index in range(1, 7)},
        }

    async def test_chunks_are_orderly_and_temp_dir_is_removed(self):
        client = FakeClient(playlist=CHUNKED_PLAYLIST, bodies=self._bodies())
        playlist = await load_hls_playlist(client, PLAYLIST_URL)
        self.assertIsNotNone(playlist)
        assert playlist is not None

        with tempfile.TemporaryDirectory() as root:
            temp_root = Path(root)
            observed: list[tuple[int, float, float, bytes]] = []
            paths: list[Path] = []

            async for chunk in iter_hls_chunks(
                client,
                playlist,
                chunk_seconds=30,
                concurrency=2,
                temp_root=temp_root,
            ):
                self.assertTrue(chunk.path.exists())
                observed.append(
                    (
                        chunk.index,
                        chunk.start,
                        chunk.duration,
                        chunk.path.read_bytes(),
                    )
                )
                paths.append(chunk.path)

            self.assertEqual(
                observed,
                [
                    (0, 0.0, 40.0, b"INITSEG1SEG2"),
                    (1, 40.0, 40.0, b"INITSEG3SEG4"),
                    (2, 80.0, 40.0, b"INITSEG5SEG6"),
                ],
            )
            self.assertTrue(all(not path.exists() for path in paths))
            self.assertEqual(list(temp_root.iterdir()), [])

    async def test_early_close_cancels_prefetch_and_cleans_temp(self):
        client = FakeClient(playlist=CHUNKED_PLAYLIST, bodies=self._bodies())
        playlist = await load_hls_playlist(client, PLAYLIST_URL)
        assert playlist is not None

        with tempfile.TemporaryDirectory() as root:
            temp_root = Path(root)
            generator = iter_hls_chunks(
                client,
                playlist,
                chunk_seconds=30,
                concurrency=2,
                temp_root=temp_root,
            )
            first = await generator.__anext__()
            first_path = first.path
            self.assertTrue(first_path.exists())

            await generator.aclose()

            self.assertFalse(first_path.exists())
            self.assertEqual(list(temp_root.iterdir()), [])

    async def test_failed_segment_cleans_temp_and_raises(self):
        base = "https://cdn.example.com/path/"
        client = FakeClient(
            playlist=CHUNKED_PLAYLIST,
            bodies=self._bodies(),
            fail_urls={base + "s2.jpg"},
        )
        playlist = await load_hls_playlist(client, PLAYLIST_URL)
        assert playlist is not None

        with tempfile.TemporaryDirectory() as root:
            temp_root = Path(root)
            with patch("services.segment_downloader.SEGMENT_RETRIES", 1):
                with self.assertRaises(HlsDownloadError):
                    async for _chunk in iter_hls_chunks(
                        client,
                        playlist,
                        chunk_seconds=30,
                        concurrency=2,
                        temp_root=temp_root,
                    ):
                        self.fail("hatalı segmentte parça üretilmemeli")

            self.assertEqual(list(temp_root.iterdir()), [])


class LiveWindowTests(unittest.IsolatedAsyncioTestCase):
    """Canlı/DVR penceresinde medya sırası ile zaman eşlemesi."""

    def test_media_sequence_and_segment_identity_are_parsed(self):
        playlist = parse_media_playlist(LIVE_PLAYLIST, PLAYLIST_URL)

        self.assertIsNotNone(playlist)
        assert playlist is not None
        self.assertFalse(playlist.endlist)
        self.assertEqual(playlist.media_sequence, 1000)
        self.assertEqual(playlist.target_duration, 6.0)
        self.assertEqual(
            [segment.sequence for segment in playlist.segments],
            [1000, 1001, 1002, 1003],
        )

    def test_vod_playlist_starts_from_its_own_sequence(self):
        playlist = parse_media_playlist(PLAYLIST, PLAYLIST_URL)
        assert playlist is not None
        self.assertEqual(playlist.media_sequence, 1)
        self.assertEqual([s.sequence for s in playlist.segments], [1, 2, 3])

    def test_segment_offset_maps_sequence_to_window_position(self):
        playlist = parse_media_playlist(LIVE_PLAYLIST, PLAYLIST_URL)
        assert playlist is not None

        self.assertEqual(segment_offset(playlist, 1000), 0.0)
        self.assertAlmostEqual(segment_offset(playlist, 1001), 6.0)
        self.assertAlmostEqual(segment_offset(playlist, 1002), 12.0)
        self.assertAlmostEqual(segment_offset(playlist, 1003), 16.0)

    def test_segment_offset_is_none_for_evicted_sequences(self):
        playlist = parse_media_playlist(LIVE_PLAYLIST, PLAYLIST_URL)
        assert playlist is not None
        self.assertIsNone(segment_offset(playlist, 999))
        self.assertIsNone(segment_offset(playlist, 1004))

    async def test_live_playlist_is_usable_for_export_playlists(self):
        client = FakeClient(playlist=LIVE_PLAYLIST)

        self.assertIsNone(await load_hls_playlist(client, PLAYLIST_URL))
        playlist = await load_hls_playlist(client, PLAYLIST_URL, allow_live=True)
        self.assertIsNotNone(playlist)

    async def test_live_shift_aligns_the_anchor_segment(self):
        client = FakeClient(playlist=LIVE_PLAYLIST)

        # İstemci çizelgesinde 1002 numaralı segment 6.0 sn'de başlıyordu;
        # güncel pencerede aynı segment 12.0 sn'de. Kayma 6.0 sn olmalı.
        shift, playlist = await live_timeline_shift(
            client,
            PLAYLIST_URL,
            {"sequence": 1002, "time": 6.0},
            None,
            start=0.0,
            end=10.0,
        )
        self.assertAlmostEqual(shift, 6.0)
        # İndirme adımı aynı anlık görüntüyü kullanmalı (pencere kaymasın).
        self.assertIsNotNone(playlist)
        assert playlist is not None
        self.assertEqual(playlist.media_sequence, 1000)

    async def test_live_shift_ignores_seconds_since_the_player_started(self):
        client = FakeClient(playlist=LIVE_PLAYLIST)

        # Bağlantı noktası klibin kendisinden geldiği için, oynatıcı açıldıktan
        # çok sonra (pencere kaymışken) da aynı sonucu vermeli.
        first, _ = await live_timeline_shift(
            client, PLAYLIST_URL, {"sequence": 1001, "time": 0.0}, None
        )
        later, _ = await live_timeline_shift(
            client, PLAYLIST_URL, {"sequence": 1001, "time": 0.0}, None
        )
        self.assertAlmostEqual(first, 6.0)
        self.assertAlmostEqual(later, 6.0)

    async def test_live_shift_rejects_a_range_outside_the_window(self):
        client = FakeClient(playlist=LIVE_PLAYLIST)

        with self.assertRaises(LiveTimelineError):
            await live_timeline_shift(
                client,
                PLAYLIST_URL,
                {"sequence": 900, "time": 0.0},
                None,
                start=0.0,
                end=5.0,
            )
        with self.assertRaises(LiveTimelineError):
            await live_timeline_shift(
                client,
                PLAYLIST_URL,
                {"sequence": 1000, "time": 0.0},
                None,
                start=0.0,
                end=500.0,
            )

    async def test_live_shift_is_zero_without_an_anchor(self):
        client = FakeClient(playlist=LIVE_PLAYLIST)
        shift, playlist = await live_timeline_shift(client, PLAYLIST_URL, None)
        self.assertEqual(shift, 0.0)
        self.assertIsNone(playlist)

    async def test_live_range_downloads_from_the_current_window(self):
        base = "https://cdn.example.com/path/"
        bodies = {
            base + f"live{sn}.ts": f"SEG{sn}".encode()
            for sn in range(1000, 1004)
        }
        client = FakeClient(playlist=LIVE_PLAYLIST, bodies=bodies)

        with tempfile.TemporaryDirectory() as root:
            download = await download_hls_range(
                client, PLAYLIST_URL, 0.0, 5.0, temp_root=Path(root)
            )
            self.assertIsNotNone(download)
            assert download is not None
            try:
                self.assertTrue(download.path.exists())
                self.assertEqual(download.start, 0.0)
                self.assertEqual(download.duration, 12.0)
            finally:
                download.cleanup()


if __name__ == "__main__":
    unittest.main()
