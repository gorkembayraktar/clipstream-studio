"""Storyboard planı, önbellek anahtarı, komut ve temizlik testleri."""
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services import storyboard  # noqa: E402


class StoryboardPlanTests(unittest.TestCase):
    def test_short_source_uses_minimum_interval(self):
        plan = storyboard.plan_storyboard(5)
        self.assertEqual(plan["interval"], 2.0)
        self.assertEqual(plan["count"], 3)
        self.assertEqual(plan["total_batches"], 1)
        self.assertEqual(plan["batch_size"], 10)

    def test_medium_source_keeps_two_second_interval(self):
        plan = storyboard.plan_storyboard(100)
        self.assertEqual(plan["interval"], 2.0)
        self.assertEqual(plan["count"], 50)
        self.assertEqual(plan["total_batches"], 5)

    def test_long_source_caps_tile_count(self):
        plan = storyboard.plan_storyboard(634.5)
        self.assertEqual(plan["interval"], 6.345)
        self.assertEqual(plan["count"], 100)
        self.assertEqual(plan["total_batches"], 10)
        self.assertLess(storyboard.sample_time(99, plan), plan["duration"])

    def test_very_long_source_remains_bounded(self):
        plan = storyboard.plan_storyboard(36_000)
        self.assertEqual(plan["count"], 100)
        self.assertEqual(plan["interval"], 360.0)
        self.assertEqual(plan["total_batches"], 10)

    def test_invalid_duration_is_rejected(self):
        with self.assertRaises(storyboard.StoryboardError):
            storyboard.plan_storyboard(0)


class StoryboardBatchTests(unittest.TestCase):
    def test_first_batch_is_spread_across_timeline(self):
        indices = storyboard.batch_indices(100, 0)

        self.assertEqual(len(indices), 10)
        self.assertEqual(indices[0], 0)
        self.assertEqual(indices[-1], 99)
        gaps = {right - left for left, right in zip(indices, indices[1:])}
        self.assertEqual(gaps, {11})

    def test_later_batch_fills_the_largest_gaps(self):
        second = storyboard.batch_indices(100, 1)

        self.assertIn(5, second)
        self.assertIn(16, second)
        self.assertIn(93, second)

    def test_batches_partition_every_frame(self):
        for count in (3, 11, 50, 100):
            total = (count + storyboard.BATCH_SIZE - 1) // storyboard.BATCH_SIZE
            flat = [
                index
                for batch in range(total)
                for index in storyboard.batch_indices(count, batch)
            ]
            self.assertEqual(sorted(flat), list(range(count)))
            self.assertEqual(len(flat), len(set(flat)))
            for batch in range(total):
                self.assertLessEqual(
                    len(storyboard.batch_indices(count, batch)),
                    storyboard.BATCH_SIZE,
                )

    def test_small_source_produces_one_batch(self):
        self.assertEqual(storyboard.batch_indices(3, 0), [0, 1, 2])
        with self.assertRaises(storyboard.StoryboardError):
            storyboard.batch_indices(3, 1)

    def test_invalid_batch_is_rejected(self):
        with self.assertRaises(storyboard.StoryboardError):
            storyboard.batch_indices(100, 10)
        with self.assertRaises(storyboard.StoryboardError):
            storyboard.batch_indices(100, -1)

    def test_sheet_layout_matches_batch_size(self):
        self.assertEqual(storyboard.sheet_layout(10), (10, 1))
        self.assertEqual(storyboard.sheet_layout(7), (7, 1))
        self.assertEqual(storyboard.sheet_layout(1), (1, 1))


class StoryboardCacheKeyTests(unittest.TestCase):
    def test_identity_headers_and_duration_change_the_key(self):
        plan = storyboard.plan_storyboard(100)
        base = storyboard._cache_key("source", None, "local-id", plan, None)
        same = storyboard._cache_key("other-source", None, "local-id", plan, None)
        headers = storyboard._cache_key(
            "source", None, "local-id", plan, {"Cookie": "a=b"}
        )
        longer = storyboard.plan_storyboard(120)
        duration = storyboard._cache_key("source", None, "local-id", longer, None)

        self.assertEqual(base, same)
        self.assertNotEqual(base, headers)
        self.assertNotEqual(base, duration)

    def test_origin_is_preferred_over_volatile_source(self):
        plan = storyboard.plan_storyboard(100)
        first = storyboard._cache_key(
            "https://cdn.example/segment-1.m3u8",
            "https://example/master.m3u8",
            None,
            plan,
            None,
        )
        second = storyboard._cache_key(
            "https://cdn.example/segment-2.m3u8",
            "https://example/master.m3u8",
            None,
            plan,
            None,
        )
        self.assertEqual(first, second)

    def test_batches_have_distinct_cache_keys(self):
        plan = storyboard.plan_storyboard(634.5)
        base = storyboard._cache_key("source", None, "local-id", plan, None)
        first = storyboard._batch_cache_key(base, 0, storyboard.batch_indices(100, 0))
        second = storyboard._batch_cache_key(base, 1, storyboard.batch_indices(100, 1))

        self.assertNotEqual(first, second)


class StoryboardCommandTests(unittest.TestCase):
    def test_tile_filter_uses_batch_layout(self):
        self.assertEqual(
            storyboard._tile_filter(10, 1, 10),
            "tile=10x1:nb_frames=10",
        )

    def test_extract_command_seeks_and_scales_one_frame(self):
        command = storyboard._extract_command(
            "video.mp4", 12.5, None, Path("frame.jpg")
        )
        filter_arg = command[command.index("-vf") + 1]

        self.assertEqual(command[command.index("-ss") + 1], "12.500")
        self.assertIn("scale=160:90", filter_arg)
        self.assertIn("pad=160:90", filter_arg)
        self.assertEqual(command[-1], "frame.jpg")

    def test_sheet_path_rejects_invalid_keys(self):
        self.assertIsNone(storyboard.sheet_path("../../secret"))
        self.assertIsNone(storyboard.sheet_path("not-a-key"))


class StoryboardSourceTests(unittest.IsolatedAsyncioTestCase):
    async def test_lightest_hls_variant_and_headers_are_used(self):
        master = """#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360
high.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=200000,RESOLUTION=320x180
low.m3u8
"""
        response = type(
            "Response",
            (),
            {
                "text": master,
                "url": "https://example.test/master.m3u8",
                "raise_for_status": lambda self: None,
            },
        )()
        client = type("Client", (), {"get": AsyncMock(return_value=response)})()
        origin = "https://example.test/master.m3u8"

        source, optimized = await storyboard._select_source(
            client, origin, "https://example.test/fallback.mp4", {"Referer": "x"}
        )

        self.assertEqual(source, "https://example.test/low.m3u8")
        self.assertTrue(optimized)
        client.get.assert_awaited_once_with(origin, headers={"Referer": "x"})


class StoryboardGenerateTests(unittest.IsolatedAsyncioTestCase):
    async def test_generate_maps_upload_route_to_local_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "video.mp4"
            source.write_bytes(b"video")
            output = root / "sheet.jpg"

            async def fake_sparse(
                resolved, plan, indices, columns, rows, headers, target, key
            ):
                target.write_bytes(b"jpeg")

            with (
                patch.object(storyboard, "local_path", return_value=source),
                patch.object(
                    storyboard, "_generate_sparse", new=AsyncMock(side_effect=fake_sparse)
                ) as generate,
            ):
                await storyboard._generate(
                    "/uploads/video.mp4",
                    storyboard.plan_storyboard(10),
                    [0, 1],
                    2,
                    1,
                    None,
                    output,
                    "k" * 40,
                )

            self.assertEqual(generate.await_args.args[0], str(source))
            self.assertTrue(output.is_file())


class StoryboardCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.cache_dir = root / "storyboard"
        self.temp_work = root / "storyboard-tmp"
        self.cache_dir.mkdir()
        self.temp_work.mkdir()
        self.patches = [
            patch.object(storyboard, "STORYBOARD_CACHE_DIR", self.cache_dir),
            patch.object(storyboard, "STORYBOARD_TEMP_DIR", self.temp_work),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp_dir.cleanup()

    def _pair(self, key: str, age_seconds: float = 0) -> None:
        (self.cache_dir / f"{key}.jpg").write_bytes(b"jpeg")
        (self.cache_dir / f"{key}.json").write_text(
            json.dumps({"source_key": key}), encoding="utf-8"
        )
        stamp = time.time() - age_seconds
        for suffix in (".jpg", ".json"):
            os.utime(self.cache_dir / f"{key}{suffix}", (stamp, stamp))

    def test_cleanup_removes_expired_pairs(self):
        self._pair("a" * 40, age_seconds=31 * 86400)
        self._pair("b" * 40, age_seconds=60)

        removed = storyboard.cleanup_storyboards(max_age_days=30, max_sheets=10)

        self.assertEqual(removed, 1)
        self.assertFalse((self.cache_dir / ("a" * 40 + ".jpg")).exists())
        self.assertTrue((self.cache_dir / ("b" * 40 + ".jpg")).exists())

    def test_cleanup_enforces_sheet_limit(self):
        self._pair("a" * 40, age_seconds=200)
        self._pair("b" * 40, age_seconds=100)

        storyboard.cleanup_storyboards(max_age_days=30, max_sheets=1)

        remaining = list(self.cache_dir.glob("*.jpg"))
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0].stem, "b" * 40)

    def test_cleanup_removes_orphan_jpeg(self):
        (self.cache_dir / ("c" * 40 + ".jpg")).write_bytes(b"jpeg")

        storyboard.cleanup_storyboards(max_age_days=30, max_sheets=10)

        self.assertFalse((self.cache_dir / ("c" * 40 + ".jpg")).exists())


class StoryboardBuildTests(unittest.IsolatedAsyncioTestCase):
    async def test_second_request_uses_disk_cache(self):
        temp_dir = tempfile.TemporaryDirectory()
        root = Path(temp_dir.name)
        cache_dir = root / "storyboard"
        temp_work = root / "storyboard-tmp"
        cache_dir.mkdir()
        temp_work.mkdir()
        url = "http://example.test/video.mp4"

        async def fake_select(*_args, **_kwargs):
            return url, False

        async def fake_generate(
            source, plan, indices, columns, rows, headers, output, key, client=None
        ):
            output.write_bytes(b"jpeg")

        try:
            with (
                patch.object(storyboard, "STORYBOARD_CACHE_DIR", cache_dir),
                patch.object(storyboard, "STORYBOARD_TEMP_DIR", temp_work),
                patch.object(storyboard, "_select_source", new=fake_select),
                patch.object(
                    storyboard, "_generate", new=AsyncMock(side_effect=fake_generate)
                ) as generate,
            ):
                first = await storyboard.build_storyboard(url, 100)
                second = await storyboard.build_storyboard(url, 100)
                next_batch = await storyboard.build_storyboard(url, 100, batch=1)
        finally:
            temp_dir.cleanup()

        self.assertFalse(first["cached"])
        self.assertTrue(second["cached"])
        self.assertEqual(first["sheet_url"], second["sheet_url"])
        self.assertEqual(first["count"], 50)
        self.assertEqual(first["total_batches"], 5)
        self.assertEqual(first["batch"], 0)
        self.assertFalse(first["complete"])
        self.assertEqual(next_batch["batch"], 1)
        self.assertNotEqual(first["sheet_url"], next_batch["sheet_url"])
        self.assertEqual(generate.await_count, 2)


if __name__ == "__main__":
    unittest.main()
