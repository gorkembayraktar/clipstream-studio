"""Bellek teşhis anlık görüntüsü ve ucunun sözleşme testleri."""
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qsl

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from api.diagnostics import memory_diagnostics_endpoint  # noqa: E402
from core.jobs import DONE, JobManager  # noqa: E402
from services.diagnostics import snapshot  # noqa: E402


class SnapshotTests(unittest.TestCase):
    def test_snapshot_reports_process_gc_and_caches(self):
        data = snapshot()
        self.assertEqual(set(data), {"process", "gc", "caches"})
        self.assertIn("rss_bytes", data["process"])
        self.assertIn("allocated_blocks", data["process"])
        self.assertIn("tracked_objects", data["gc"])

    def test_snapshot_covers_every_bounded_cache(self):
        caches = snapshot()["caches"]
        self.assertEqual(
            set(caches),
            {
                "frames",
                "local_files",
                "thumbnail_locks",
                "audio_without_cover",
                "header_tokens",
                "streams",
                "library_meta",
                "waveform_locks",
                "export_paths",
            },
        )
        # Sınırı olan her önbellek sınırını da bildirmeli.
        self.assertEqual(caches["frames"]["limit_bytes"], 8 * 1024 * 1024)
        self.assertEqual(caches["local_files"]["limit"], 512)
        self.assertEqual(caches["thumbnail_locks"]["limit"], 512)
        self.assertEqual(caches["waveform_locks"]["limit"], 32)
        self.assertEqual(caches["header_tokens"]["limit"], 64)

    def test_collect_is_opt_in(self):
        self.assertNotIn("collect", snapshot())
        data = snapshot(collect=True)
        self.assertIn("unreachable", data["collect"])


class MemoryEndpointTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.manager = JobManager()
        done = self.manager.create({"url": "a"})
        done["status"] = DONE
        done.pop("payload", None)
        self.manager.create({"url": "b"})

    async def get(self, query: str) -> dict:
        request = SimpleNamespace(
            query_params=dict(parse_qsl(query)),
            app=SimpleNamespace(state=SimpleNamespace(jobs=self.manager)),
        )
        response = await memory_diagnostics_endpoint(request)
        return json.loads(response.body)

    async def test_reports_job_counts(self):
        data = await self.get("")
        self.assertTrue(data["success"])
        self.assertEqual(data["jobs"]["total"], 2)
        self.assertEqual(data["jobs"]["by_status"], {"done": 1, "pending": 1})
        # Yalnızca bekleyen iş istek gövdesini tutar.
        self.assertEqual(data["jobs"]["with_payload"], 1)

    async def test_collect_flag_reaches_the_snapshot(self):
        data = await self.get("collect=true")
        self.assertIn("collect", data)


if __name__ == "__main__":
    unittest.main()
