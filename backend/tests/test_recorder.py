"""Canlı kayıt yöneticisi: segment yakalama sırası, dayanıklılık, akışa yazma."""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from core.i18n import t
from services import recorder as recorder_module
from services import streams as streams_module
from services.recorder import RecorderManager, RecordingError, _poll_interval
from services.segment_downloader import MediaPlaylist, MediaSegment

PROJECT_ID = "proj-1234"


def make_playlist(
    sequences: list[int],
    *,
    target: float = 2.0,
    endlist: bool = False,
    url: str = "https://cdn.example/live/media.m3u8",
) -> MediaPlaylist:
    segments = [
        MediaSegment(url=f"https://cdn.example/live/{sequence}.ts", duration=4.0, sequence=sequence)
        for sequence in sequences
    ]
    return MediaPlaylist(
        segments=segments,
        duration=sum(segment.duration for segment in segments),
        endlist=endlist,
        media_sequence=sequences[0] if sequences else 0,
        target_duration=target,
        url=url,
    )


class RecorderTestCase(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.recordings_dir = self.root / "recordings"
        self.recordings_dir.mkdir()
        self.streams_dir = self.root / "streams"
        self.streams_dir.mkdir()

        for module, name, value in (
            (recorder_module, "RECORDINGS_DIR", self.recordings_dir),
            (streams_module, "STREAMS_DIR", self.streams_dir),
        ):
            patcher = mock.patch.object(module, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        streams_module.forget_cache()
        self.addCleanup(streams_module.forget_cache)

        # ffprobe çağrılmasın: segmentler sahte baytlar.
        probe = mock.patch.object(
            streams_module, "_probe", mock.AsyncMock(return_value=None)
        )
        probe.start()
        self.addCleanup(probe.stop)

        self.manager = RecorderManager()
        self.manager._client = object()  # ağ kullanılmıyor: indirme sahte
        self.downloads: list[str] = []

    # ------------------------------------------------------------------ yardımcılar
    def use_playlists(self, playlists: list[MediaPlaylist]) -> None:
        """`_load_playlist` sırayla bu playlist'leri döner (sonuncusu sabit kalır)."""
        queue = list(playlists)

        async def fake_load(url: str, headers=None) -> MediaPlaylist:
            return queue.pop(0) if len(queue) > 1 else queue[0]

        async def fake_download(url: str, headers=None) -> bytes:
            self.downloads.append(url)
            return url.encode("utf-8")

        self.manager._load_playlist = fake_load  # type: ignore[method-assign]
        self.manager._download = fake_download  # type: ignore[method-assign]

    async def start(self, url: str = "https://cdn.example/live/master.m3u8") -> dict:
        return await self.manager.start(
            {"url": url, "title": "Test kaydı", "project_id": PROJECT_ID}
        )

    async def wait_for(self, predicate, timeout: float = 5.0) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while loop.time() < deadline:
            if predicate():
                return
            await asyncio.sleep(0.01)
        raise AssertionError("beklenen durum oluşmadı")

    def stream(self) -> dict:
        summary = streams_module.summary(PROJECT_ID)
        self.assertIsNotNone(summary)
        return summary

    def segment_bytes(self, index: int = 0) -> bytes:
        files = sorted((self.streams_dir / PROJECT_ID).glob("seg_*.ts"))
        return files[index].read_bytes() if len(files) > index else b""

    # ---------------------------------------------------------------------- testler
    async def test_new_recording_starts_at_live_edge_and_writes_to_stream(self) -> None:
        self.use_playlists([make_playlist([100, 101, 102, 103, 104])])
        record = await self.start()
        record_id = record["id"]
        self.assertEqual(record["stream_id"], PROJECT_ID)

        await self.wait_for(lambda: self.manager._records[record_id]["segments"] == 1)

        self.assertEqual(self.downloads, ["https://cdn.example/live/104.ts"])
        self.assertEqual(
            self.segment_bytes(), b"https://cdn.example/live/104.ts"
        )
        state = self.manager._records[record_id]
        self.assertEqual(state["last_sequence"], 104)
        self.assertEqual(state["gaps"], 0)
        self.assertAlmostEqual(state["duration"], 4.0)

        summary = self.stream()
        self.assertAlmostEqual(summary["duration"], 4.0)
        self.assertEqual(summary["revision"], 1)
        self.assertEqual(len(summary["blocks"]), 1)
        self.assertEqual(summary["blocks"][0]["recording_id"], record_id)
        self.assertEqual(summary["blocks"][0]["title"], "Test kaydı")
        await self.manager._cancel(record_id)

    async def test_playlist_is_event_with_finite_vod_copy(self) -> None:
        self.use_playlists([make_playlist([1, 2])])
        record = await self.start()
        await self.wait_for(lambda: self.manager._records[record["id"]]["segments"] == 1)
        await self.manager._cancel(record["id"])

        directory = self.streams_dir / PROJECT_ID
        # Tarayıcı: büyüyen EVENT listesi (ENDLIST yok, kayıt bitince yükleme yok).
        playlist = (directory / "index.m3u8").read_text("utf-8")
        self.assertIn("#EXT-X-PLAYLIST-TYPE:EVENT", playlist)
        self.assertNotIn("#EXT-X-ENDLIST", playlist)
        self.assertIn("seg_000001.ts", playlist)
        self.assertIn("#EXTINF:4.000,", playlist)

        # ffmpeg/ffprobe: sonlu kopya (ENDLIST var, yayın sanıp beklemez).
        vod = (directory / "index.vod.m3u8").read_text("utf-8")
        self.assertIn("seg_000001.ts", vod)
        self.assertIn("#EXT-X-ENDLIST", vod)

    async def test_resume_continues_in_order_and_counts_gaps(self) -> None:
        self.use_playlists([make_playlist([100, 101, 102])])
        record = await self.start()
        record_id = record["id"]
        await self.wait_for(lambda: self.manager._records[record_id]["segments"] == 1)
        await self.manager._cancel(record_id)

        # Pencere ilerledi: 102 zaten kayıtlı, 103-104 sırayla eklenir.
        self.use_playlists([make_playlist([100, 101, 102, 103, 104])])
        await self.manager.resume(record_id)
        await self.wait_for(lambda: self.manager._records[record_id]["segments"] == 3)
        await self.manager._cancel(record_id)

        summary = self.stream()
        self.assertEqual(summary["blocks"][0]["segments"], 3)
        self.assertEqual(
            [segment["source_sequence"] for segment in streams_module.load(PROJECT_ID)["segments"]],
            [102, 103, 104],
        )
        self.assertEqual(self.manager._records[record_id]["gaps"], 0)

        # Pencere atladı: 105 kaçtı → boşluk sayılır, kayıt devam eder.
        self.use_playlists([make_playlist([106, 107, 108, 109, 110])])
        await self.manager.resume(record_id)
        await self.wait_for(lambda: self.manager._records[record_id]["segments"] >= 8)
        await self.manager._cancel(record_id)

        self.assertEqual(self.manager._records[record_id]["gaps"], 1)
        self.assertEqual(
            streams_module.load(PROJECT_ID)["segments"][-1]["source_sequence"], 110
        )

    async def test_failed_segment_is_skipped_without_stopping(self) -> None:
        self.use_playlists([make_playlist([10, 11])])
        record = await self.start()
        record_id = record["id"]
        await self.wait_for(lambda: self.manager._records[record_id]["segments"] == 1)
        await self.manager._cancel(record_id)

        async def flaky(url: str, headers=None):
            if url.endswith("/12.ts"):
                return None
            return url.encode("utf-8")

        self.use_playlists([make_playlist([10, 11, 12, 13])])
        self.manager._download = flaky  # type: ignore[method-assign]
        await self.manager.resume(record_id)
        await self.wait_for(lambda: self.manager._records[record_id]["segments"] == 2)
        await self.manager._cancel(record_id)

        self.assertEqual(self.manager._records[record_id]["gaps"], 1)
        self.assertEqual(
            streams_module.load(PROJECT_ID)["segments"][-1]["source_sequence"], 13
        )

    async def test_stop_is_instant_and_keeps_segments(self) -> None:
        self.use_playlists([make_playlist([1])])
        record = await self.start()
        record_id = record["id"]
        await self.wait_for(lambda: self.manager._records[record_id]["segments"] == 1)

        stopped = await self.manager.stop(record_id)
        self.assertEqual(stopped["status"], "stopped")
        # Durdurma dönüştürme yapmaz: durum klasörü hemen silinir.
        self.assertNotIn(record_id, self.manager._records)
        self.assertFalse((self.recordings_dir / record_id).exists())
        self.assertEqual(len(self.stream()["blocks"]), 1)

        # İkinci kez durdurmak hata değil.
        self.assertIsNone(await self.manager.stop(record_id))

    async def test_pause_keeps_stream_and_resume_continues(self) -> None:
        self.use_playlists([make_playlist([20, 21])])
        record = await self.start()
        record_id = record["id"]
        await self.wait_for(lambda: self.manager._records[record_id]["segments"] == 1)

        await self.manager.pause(record_id)
        state = self.manager._records[record_id]
        self.assertEqual(state["status"], "paused")
        self.assertTrue((self.streams_dir / PROJECT_ID / "seg_000001.ts").is_file())

        self.use_playlists([make_playlist([20, 21, 22])])
        await self.manager.resume(record_id)
        await self.wait_for(lambda: self.manager._records[record_id]["segments"] == 2)
        await self.manager._cancel(record_id)

        self.assertEqual(
            streams_module.load(PROJECT_ID)["segments"][-1]["source_sequence"], 22
        )

    async def test_start_rejects_non_live_playlist(self) -> None:
        self.use_playlists([make_playlist([1, 2], endlist=True)])
        with self.assertRaises(RecordingError) as caught:
            await self.start()
        self.assertEqual(str(caught.exception), t("error.recordNotLive"))
        self.assertEqual(caught.exception.status_code, 409)

    async def test_start_rejects_unreadable_playlist(self) -> None:
        async def fake_load(url: str, headers=None):
            return None

        self.manager._load_playlist = fake_load  # type: ignore[method-assign]
        with self.assertRaises(RecordingError) as caught:
            await self.start()
        self.assertEqual(caught.exception.status_code, 415)

    async def test_start_requires_project(self) -> None:
        with self.assertRaises(RecordingError) as caught:
            await self.manager.start({"url": "https://cdn.example/live/master.m3u8"})
        self.assertEqual(str(caught.exception), t("error.recordProjectMissing"))

    async def test_second_recording_in_same_project_is_rejected(self) -> None:
        self.use_playlists([make_playlist([1, 2, 3])])
        record = await self.start()
        with self.assertRaises(RecordingError) as caught:
            await self.start()
        self.assertEqual(caught.exception.status_code, 409)
        await self.manager._cancel(record["id"])

    async def test_restore_resumes_recording(self) -> None:
        recording_id = "rec_aaaaaaaaaaaa"
        directory = self.recordings_dir / recording_id
        directory.mkdir()
        (directory / "state.json").write_text(
            json.dumps(
                {
                    "version": 2,
                    "id": recording_id,
                    "title": "Yarıda kalan",
                    "status": "recording",
                    "url": "https://cdn.example/live/master.m3u8",
                    "media_url": "https://cdn.example/live/media.m3u8",
                    "headers": {},
                    "created_at": 1.0,
                    "updated_at": 1.0,
                    "duration": 8.0,
                    "segments": 2,
                    "bytes": 100,
                    "gaps": 0,
                    "last_sequence": 7,
                    "lang": "tr",
                    "project_id": PROJECT_ID,
                    "stream_id": PROJECT_ID,
                }
            ),
            encoding="utf-8",
        )

        spawning = []
        with mock.patch.object(
            self.manager,
            "_spawn_capture",
            lambda record: spawning.append(record["id"]),
        ):
            await self.manager.restore()

        self.assertEqual(spawning, [recording_id])
        self.assertEqual(self.manager._records[recording_id]["last_sequence"], 7)

    async def test_restore_skips_legacy_records(self) -> None:
        record_id = "rec_bbbbbbbbbbbb"
        directory = self.recordings_dir / record_id
        directory.mkdir()
        (directory / "state.json").write_text(
            json.dumps({"version": 1, "id": record_id, "status": "stopped"}),
            encoding="utf-8",
        )

        await self.manager.restore()
        self.assertNotIn(record_id, self.manager._records)

    async def test_delete_removes_state(self) -> None:
        self.use_playlists([make_playlist([5])])
        record = await self.start()
        record_id = record["id"]
        await self.wait_for(lambda: self.manager._records[record_id]["segments"] == 1)

        await self.manager.delete(record_id)

        self.assertNotIn(record_id, self.manager._records)
        self.assertFalse((self.recordings_dir / record_id).exists())

    def test_public_hides_headers(self) -> None:
        record = {
            "id": "rec_x",
            "title": "t",
            "status": "recording",
            "headers": {"cookie": "secret"},
            "url": "https://cdn.example/live.m3u8",
        }
        public = self.manager.public(record)
        self.assertNotIn("headers", public)
        self.assertNotIn("url", public)


class PlaylistIntervalTests(unittest.TestCase):
    def test_poll_interval_follows_target_duration(self) -> None:
        self.assertEqual(_poll_interval(make_playlist([1, 2], target=2.0)), 2.0)
        self.assertEqual(_poll_interval(make_playlist([1, 2], target=30.0)), 12.0)
        self.assertEqual(_poll_interval(make_playlist([1, 2], target=0.0)), 4.0)

    def test_playlist_keeps_its_url(self) -> None:
        playlist = make_playlist([1], url="https://cdn.example/a/media.m3u8")
        self.assertEqual(playlist.url, "https://cdn.example/a/media.m3u8")
