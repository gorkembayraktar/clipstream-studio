"""İş merkezinin listeleme ve genel görünüm davranışı için birim testleri."""
import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.jobs import DONE, ERROR, PENDING, RUNNING, JobManager  # noqa: E402


class JobListTests(unittest.TestCase):
    def setUp(self):
        self.manager = JobManager()
        self.first = self.manager.create({"url": "a"})
        self.second = self.manager.create({"url": "b"})
        self.third = self.manager.create({"url": "c"})
        # Aynı saniyede oluşturulabilirler; sıralamayı sabitle.
        self.first["created_at"] = 1.0
        self.second["created_at"] = 2.0
        self.third["created_at"] = 3.0

    def test_lists_all_jobs_oldest_first(self):
        ids = [job["id"] for job in self.manager.list_jobs()]
        self.assertEqual(
            ids,
            [self.first["id"], self.second["id"], self.third["id"]],
        )

    def test_active_only_skips_terminal_statuses(self):
        self.first["status"] = RUNNING
        self.second["status"] = DONE
        self.third["status"] = ERROR
        ids = [job["id"] for job in self.manager.list_jobs(active_only=True)]
        self.assertEqual(ids, [self.first["id"]])

    def test_active_only_keeps_pending_and_running(self):
        self.first["status"] = PENDING
        self.second["status"] = DONE
        self.third["status"] = RUNNING
        ids = [job["id"] for job in self.manager.list_jobs(active_only=True)]
        self.assertEqual(ids, [self.first["id"], self.third["id"]])

    def test_public_view_hides_internal_fields(self):
        job = self.manager.create({"url": "a"}, lang="tr")
        job["process"] = object()
        view = self.manager.public_view(job)
        self.assertNotIn("payload", view)
        self.assertNotIn("lang", view)
        self.assertNotIn("process", view)
        self.assertEqual(view["id"], job["id"])
        self.assertEqual(view["lane"], "cpu")

    def test_lane_defaults_to_cpu_and_follows_encoder(self):
        self.assertEqual(self.first["lane"], "cpu")
        gpu = self.manager.create({"url": "gpu", "encoder": "gpu"})
        self.assertEqual(gpu["lane"], "gpu")
        uppercase = self.manager.create({"url": "gpu", "encoder": "GPU"})
        self.assertEqual(uppercase["lane"], "gpu")

    def test_queue_positions_are_independent_per_lane(self):
        gpu_one = self.manager.create({"url": "g1", "encoder": "gpu"})
        gpu_two = self.manager.create({"url": "g2", "encoder": "gpu"})
        self.assertEqual(self.manager.queue_position(self.first), 1)
        self.assertEqual(self.manager.queue_position(self.second), 2)
        self.assertEqual(self.manager.queue_position(self.third), 3)
        self.assertEqual(self.manager.queue_position(gpu_one), 1)
        self.assertEqual(self.manager.queue_position(gpu_two), 2)

    def test_running_job_has_no_queue_position(self):
        self.first["status"] = RUNNING
        self.assertIsNone(self.manager.queue_position(self.first))
        self.assertEqual(self.manager.queue_position(self.second), 1)

    def test_public_view_exposes_queue_position_for_pending_jobs(self):
        view = self.manager.public_view(self.second)
        self.assertEqual(view["queue_position"], 2)
        self.first["status"] = RUNNING
        self.assertNotIn("queue_position", self.manager.public_view(self.first))

    def test_requested_filename_is_exposed_before_output_exists(self):
        job = self.manager.create({"url": "a", "filename": "my clip"})
        view = self.manager.public_view(job)
        self.assertEqual(view["requested_filename"], "my clip")
        self.assertNotIn("output_filename", view)
        unnamed = self.manager.create({"url": "b", "filename": "   "})
        self.assertIsNone(self.manager.public_view(unnamed)["requested_filename"])

    def test_public_view_fills_requested_metadata_for_queued_jobs(self):
        job = self.manager.create(
            {
                "url": "a",
                "output_format": "GIF",
                "mode": "fast",
                "quality": "high",
                "codec": "hevc",
                "output_fps": 30,
                "start_time": 1.5,
                "end_time": 4.0,
            }
        )
        view = self.manager.public_view(job)
        self.assertEqual(view["output_format"], "gif")
        self.assertEqual(view["mode"], "fast")
        self.assertEqual(view["quality"], "high")
        self.assertEqual(view["codec"], "hevc")
        self.assertEqual(view["output_fps"], 30)
        self.assertEqual(view["clip_start"], 1.5)
        self.assertEqual(view["clip_end"], 4.0)


if __name__ == "__main__":
    unittest.main()
