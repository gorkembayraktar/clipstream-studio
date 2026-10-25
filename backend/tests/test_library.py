"""Galeri metadata uç noktası: güvenli çözümleme, ffprobe ve önbellek."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from api import library as library_api  # noqa: E402
from services import library  # noqa: E402
from services.prober import ProbeError  # noqa: E402


def probe_result(**overrides):
    result = {
        "success": True,
        "duration": 12.5,
        "size_bytes": 1024,
        "size_mb": 0.0,
        "width": 1920,
        "height": 1080,
        "fps": 30.0,
        "codec": "h264",
        "has_audio": True,
        "has_video": True,
        "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
    }
    result.update(overrides)
    return result


class LibraryMetaTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.exports = Path(self.temp_dir.name)

        patcher = patch.object(library, "EXPORTS_DIR", self.exports)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.file = self.exports / "clip.mp4"
        self.file.write_bytes(b"fake video")

        library._META_CACHE.clear()
        self.addCleanup(library._META_CACHE.clear)

    async def test_returns_normalized_metadata_and_caches_it(self):
        probe = AsyncMock(return_value=probe_result())
        with patch.object(library, "probe_url", probe):
            first = await library.get_file_meta("clip.mp4")
            second = await library.get_file_meta("clip.mp4")

        self.assertTrue(first["success"])
        self.assertEqual(first["name"], "clip.mp4")
        self.assertEqual(first["width"], 1920)
        self.assertEqual(first["height"], 1080)
        self.assertAlmostEqual(first["duration"], 12.5)
        self.assertEqual(first["fps"], 30.0)
        self.assertEqual(first["codec"], "h264")
        self.assertTrue(first["has_audio"])
        self.assertTrue(first["has_video"])
        self.assertEqual(first["size_bytes"], len(b"fake video"))
        self.assertFalse(first["cached"])
        self.assertTrue(second["cached"])
        self.assertEqual(probe.await_count, 1)

    async def test_cache_invalidates_when_file_changes(self):
        probe = AsyncMock(return_value=probe_result())
        with patch.object(library, "probe_url", probe):
            await library.get_file_meta("clip.mp4")
            stat = self.file.stat()
            os.utime(
                self.file,
                ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000),
            )
            await library.get_file_meta("clip.mp4")

        self.assertEqual(probe.await_count, 2)

    async def test_rejects_path_traversal(self):
        with self.assertRaises(library.LibraryError):
            await library.get_file_meta("../outside.mp4")

    async def test_endpoint_returns_probe_metadata(self):
        with patch.object(
            library_api,
            "get_file_meta",
            AsyncMock(return_value=probe_result(name="clip.mp4")),
        ):
            response = await library_api.file_meta_endpoint(_request("clip.mp4"))

        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.body)
        self.assertEqual(payload["name"], "clip.mp4")
        self.assertEqual(payload["codec"], "h264")

    async def test_endpoint_maps_library_and_probe_errors(self):
        with patch.object(
            library_api,
            "get_file_meta",
            AsyncMock(side_effect=library.LibraryError("missing")),
        ):
            response = await library_api.file_meta_endpoint(_request("missing.mp4"))
        self.assertEqual(response.status_code, 404)
        self.assertFalse(json.loads(response.body)["success"])

        with patch.object(
            library_api,
            "get_file_meta",
            AsyncMock(side_effect=ProbeError("timed out", status_code=504)),
        ):
            response = await library_api.file_meta_endpoint(_request("clip.mp4"))
        self.assertEqual(response.status_code, 504)
        self.assertEqual(json.loads(response.body)["error"], "timed out")

    async def test_delete_endpoint_distinguishes_missing_and_locked_files(self):
        with patch.object(
            library_api,
            "delete_file",
            side_effect=library.LibraryError("missing"),
        ):
            response = await library_api.delete_file_endpoint(_request("missing.mp4"))
        self.assertEqual(response.status_code, 404)
        self.assertFalse(json.loads(response.body)["success"])

        def locked_file(_filename):
            try:
                raise PermissionError("file is locked")
            except OSError as exc:
                raise library.LibraryError("locked") from exc

        with patch.object(library_api, "delete_file", side_effect=locked_file):
            response = await library_api.delete_file_endpoint(_request("locked.mp4"))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.body)["error"], "locked")


class _request:
    def __init__(self, filename: str):
        self.path_params = {"filename": filename}


if __name__ == "__main__":
    unittest.main()
