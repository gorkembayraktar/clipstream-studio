"""Proje akışı: segment ekleme, playlist, bloklar, silme ve yol eşlemesi."""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from config import STREAMS_ROUTE
from services import local_media, streams
from services.local_media import local_path


class StreamStoreTestCase(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        for module in (streams, local_media):
            patcher = mock.patch.object(module, "STREAMS_DIR", self.root)
            patcher.start()
            self.addCleanup(patcher.stop)
        streams.forget_cache()
        self.addCleanup(streams.forget_cache)

        probe = mock.patch.object(
            streams, "_probe", mock.AsyncMock(return_value=None)
        )
        probe.start()
        self.addCleanup(probe.stop)

    async def append(self, recording_id: str, *, duration: float = 4.0, title: str = "kayıt"):
        return await streams.append(
            "proj-1",
            data=b"segment",
            duration=duration,
            recording_id=recording_id,
            title=title,
        )

    async def test_append_creates_index_playlist_and_summary(self) -> None:
        summary = await self.append("rec_a")
        self.assertEqual(summary["segments"], 1)
        self.assertEqual(summary["revision"], 1)
        self.assertAlmostEqual(summary["duration"], 4.0)
        self.assertEqual(summary["bytes"], 7)

        directory = self.root / "proj-1"
        self.assertTrue((directory / "seg_000001.ts").is_file())
        self.assertTrue((directory / "index.json").is_file())
        playlist = (directory / "index.m3u8").read_text("utf-8")
        self.assertIn("#EXTINF:4.000,", playlist)
        self.assertIn("seg_000001.ts", playlist)
        self.assertIn("#EXT-X-PLAYLIST-TYPE:EVENT", playlist)
        self.assertIn("#EXT-X-MEDIA-SEQUENCE:0", playlist)
        # EVENT: liste bitmez, oynatıcı yoklayarak büyütür (yeniden yükleme yok).
        self.assertNotIn("#EXT-X-ENDLIST", playlist)
        self.assertIn("#EXT-X-TARGETDURATION:4", playlist)

        # ffmpeg/ffprobe için sonlu kopya (aynı segmentler + ENDLIST).
        vod = (directory / "index.vod.m3u8").read_text("utf-8")
        self.assertIn("seg_000001.ts", vod)
        self.assertTrue(vod.rstrip().endswith("#EXT-X-ENDLIST"))

        # Yalnızca yıkıcı değişimde artan sayaç: ekleme adresi değiştirmez.
        self.assertEqual(summary["playback"], 0)

    async def test_second_recording_continues_after_first(self) -> None:
        await self.append("rec_a", duration=4.0)
        summary = await self.append("rec_b", duration=6.0)
        self.assertAlmostEqual(summary["duration"], 10.0)
        self.assertEqual(len(summary["blocks"]), 2)
        first, second = summary["blocks"]
        self.assertAlmostEqual(first["start"], 0.0)
        self.assertAlmostEqual(first["end"], 4.0)
        self.assertAlmostEqual(second["start"], 4.0)
        self.assertAlmostEqual(second["end"], 10.0)
        self.assertEqual(second["title"], "kayıt")

        playlist = (self.root / "proj-1" / "index.m3u8").read_text("utf-8")
        self.assertEqual(playlist.count("#EXT-X-DISCONTINUITY"), 1)
        # İkinci kayıt eklendiğinde adres tazelenmez; sayaç değişmez.
        self.assertEqual(summary["playback"], 0)

    async def test_blocks_group_consecutive_segments(self) -> None:
        await self.append("rec_a")
        await self.append("rec_a")
        summary = await self.append("rec_b")
        self.assertEqual(len(summary["blocks"]), 2)
        self.assertEqual(summary["blocks"][0]["segments"], 2)

    async def test_remove_recording_deletes_files_and_shifts_times(self) -> None:
        await self.append("rec_a", duration=4.0)
        await self.append("rec_b", duration=6.0)
        await self.append("rec_c", duration=2.0)

        summary = await streams.remove_recording("proj-1", "rec_b")
        self.assertAlmostEqual(summary["duration"], 6.0)
        self.assertEqual([block["recording_id"] for block in summary["blocks"]], ["rec_a", "rec_c"])
        # Silme yıkıcıdır: oynatma adresi tazelenmeli.
        self.assertEqual(summary["playback"], 1)
        # Silinen dosya diskte kalmamalı.
        self.assertFalse((self.root / "proj-1" / "seg_000002.ts").exists())
        self.assertTrue((self.root / "proj-1" / "seg_000003.ts").is_file())
        # Kalan kayıtlar yeniden numaralanmaz; yeni segment çakışmaz.
        await self.append("rec_d", duration=1.0)
        self.assertTrue((self.root / "proj-1" / "seg_000004.ts").is_file())

    async def test_legacy_vod_playlist_is_upgraded_on_load(self) -> None:
        await self.append("rec_a", duration=4.0)
        directory = self.root / "proj-1"
        legacy = (
            "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n"
            "#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n"
            "#EXTINF:4.000,\nseg_000001.ts\n#EXT-X-ENDLIST\n"
        )
        (directory / "index.m3u8").write_text(legacy, encoding="utf-8")
        (directory / "index.vod.m3u8").unlink()
        streams.forget_cache()

        record = streams.load("proj-1")
        self.assertIsNotNone(record)
        playlist = (directory / "index.m3u8").read_text("utf-8")
        self.assertIn("#EXT-X-PLAYLIST-TYPE:EVENT", playlist)
        self.assertNotIn("#EXT-X-ENDLIST", playlist)
        self.assertTrue((directory / "index.vod.m3u8").is_file())

    async def test_remove_unknown_recording_raises(self) -> None:
        await self.append("rec_a")
        with self.assertRaises(streams.StreamError):
            await streams.remove_recording("proj-1", "rec_yok")

    async def test_summary_missing_stream_is_none(self) -> None:
        self.assertIsNone(streams.summary("proj-yok"))

    async def test_segment_path_rejects_traversal(self) -> None:
        self.assertIsNone(streams.segment_path("proj-1", "../index.json"))
        self.assertIsNone(streams.segment_path("proj-1", "seg_000001.mp4"))
        self.assertIsNone(streams.segment_path("../proj-1", "seg_000001.ts"))
        self.assertIsNotNone(streams.segment_path("proj-1", "seg_000001.ts"))

    async def test_playlist_url_uses_route(self) -> None:
        self.assertTrue(streams.playlist_url("proj-1").endswith(f"{STREAMS_ROUTE}/proj-1/index.m3u8"))

    async def test_local_path_resolves_playlist(self) -> None:
        await self.append("rec_a")
        url = streams.playlist_url("proj-1")
        # ffmpeg/ffprobe sonlu (VOD) kopyayı okur.
        self.assertEqual(
            local_path(url).resolve(), (self.root / "proj-1" / "index.vod.m3u8").resolve()
        )
        # Sorgu dizesi (sürüm) yolu değiştirmez.
        self.assertEqual(
            local_path(f"{url}?v=12").resolve(),
            (self.root / "proj-1" / "index.vod.m3u8").resolve(),
        )
        # Yol kaçırma denemesi reddedilir.
        self.assertIsNone(local_path(f"{STREAMS_ROUTE}/../index.json"))
