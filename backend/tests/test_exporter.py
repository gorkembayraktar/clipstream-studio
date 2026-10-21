"""Dışa aktarma komutu ve GPU kodlayıcı seçimi için birim testleri."""
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.exporter import (  # noqa: E402
    ExportError,
    build_ffmpeg_command,
    is_gpu_render_eligible,
    select_gpu_encoder,
)
from services.gpu import (  # noqa: E402
    GPU_ENCODERS,
    GpuCapability,
    get_gpu_encoder,
    gpu_encoder_arguments,
)


def make_payload(**overrides):
    payload = {
        "url": "https://example.com/source.mp4",
        "start_time": 1.25,
        "end_time": 4.75,
        "mode": "exact",
        "output_format": "mp4",
        "crop": None,
        "filename": "test",
    }
    payload.update(overrides)
    return payload


class GpuEligibilityTests(unittest.TestCase):
    def test_exact_mp4_is_eligible(self):
        self.assertTrue(is_gpu_render_eligible("mp4", "exact", None))

    def test_fast_copy_is_not_eligible(self):
        self.assertFalse(is_gpu_render_eligible("mp4", "fast", None))

    def test_crop_makes_fast_mode_eligible(self):
        self.assertTrue(
            is_gpu_render_eligible(
                "mp4", "fast", {"x": 0, "y": 0, "width": 640, "height": 360}
            )
        )

    def test_gif_and_mp3_are_not_eligible(self):
        self.assertFalse(is_gpu_render_eligible("gif", "exact", None))
        self.assertFalse(is_gpu_render_eligible("mp3", "exact", None))


class FfmpegCommandTests(unittest.TestCase):
    def test_cpu_exact_uses_libx264(self):
        command = build_ffmpeg_command(make_payload(), Path("out.mp4"))
        self.assertIn("libx264", command)
        self.assertIn("-crf", command)
        self.assertNotIn("h264_nvenc", command)

    def test_gpu_exact_uses_nvenc(self):
        command = build_ffmpeg_command(
            make_payload(), Path("out.mp4"), gpu_encoder="h264_nvenc"
        )
        self.assertIn("h264_nvenc", command)
        self.assertIn("-cq", command)
        self.assertNotIn("libx264", command)

    def test_gpu_qsv_uses_global_quality(self):
        command = build_ffmpeg_command(
            make_payload(), Path("out.mp4"), gpu_encoder="h264_qsv"
        )
        self.assertIn("h264_qsv", command)
        self.assertIn("-global_quality", command)
        self.assertNotIn("libx264", command)

    def test_gpu_is_ignored_for_fast_copy(self):
        command = build_ffmpeg_command(
            make_payload(mode="fast"), Path("out.mp4"), gpu_encoder="h264_nvenc"
        )
        self.assertIn("copy", command)
        self.assertNotIn("h264_nvenc", command)
        self.assertNotIn("libx264", command)

    def test_gpu_is_used_for_crop_even_in_fast_mode(self):
        crop = {
            "enabled": True,
            "x": 0,
            "y": 0,
            "width": 640,
            "height": 360,
            "source_width": 1920,
            "source_height": 1080,
        }
        command = build_ffmpeg_command(
            make_payload(mode="fast", crop=crop),
            Path("out.mp4"),
            gpu_encoder="h264_nvenc",
        )
        self.assertIn("h264_nvenc", command)
        self.assertNotIn("libx264", command)
        self.assertIn("crop=640:360:0:0", command)

    def test_gpu_is_ignored_for_gif(self):
        command = build_ffmpeg_command(
            make_payload(output_format="gif"),
            Path("out.gif"),
            gpu_encoder="h264_nvenc",
        )
        self.assertNotIn("h264_nvenc", command)
        self.assertIn("palettegen", " ".join(command))

    def test_unknown_gpu_encoder_is_rejected(self):
        with self.assertRaises(ExportError):
            build_ffmpeg_command(
                make_payload(), Path("out.mp4"), gpu_encoder="h264_unknown"
            )

    def test_encoder_registry(self):
        self.assertIsNotNone(get_gpu_encoder("h264_nvenc"))
        self.assertIsNone(get_gpu_encoder("not-an-encoder"))
        arguments = gpu_encoder_arguments("h264_amf")
        self.assertEqual(arguments[:2], ["-c:v", "h264_amf"])


class GpuSelectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_cpu_request_returns_no_encoder(self):
        encoder, reason, detail, label = await select_gpu_encoder(make_payload())
        self.assertIsNone(encoder)
        self.assertIsNone(reason)
        self.assertIsNone(detail)
        self.assertIsNone(label)

    async def test_gpu_request_without_encoder_reports_reason(self):
        capability = GpuCapability(reason_key="gpu.reason.buildMissing", checked_at=1.0)
        with patch(
            "services.exporter.detect_gpu_capability",
            new=AsyncMock(return_value=capability),
        ):
            encoder, reason, detail, label = await select_gpu_encoder(
                make_payload(encoder="gpu")
            )
        self.assertIsNone(encoder)
        self.assertIn("GPU rendering is unavailable", reason or "")
        self.assertIn("no NVIDIA NVENC", reason or "")
        self.assertIsNone(detail)
        self.assertIsNone(label)

    async def test_gpu_request_uses_detected_encoder(self):
        capability = GpuCapability(encoder=GPU_ENCODERS[0], checked_at=1.0)
        with patch(
            "services.exporter.detect_gpu_capability",
            new=AsyncMock(return_value=capability),
        ):
            encoder, reason, detail, label = await select_gpu_encoder(
                make_payload(encoder="gpu")
            )
        self.assertEqual(encoder, "h264_nvenc")
        self.assertIsNone(reason)
        self.assertIsNone(detail)
        self.assertEqual(label, "NVIDIA NVENC")

    async def test_gpu_request_is_rejected_for_fast_copy(self):
        encoder, reason, detail, label = await select_gpu_encoder(
            make_payload(encoder="gpu", mode="fast")
        )
        self.assertIsNone(encoder)
        self.assertIn("only for MP4", reason or "")
        self.assertIsNone(detail)
        self.assertIsNone(label)


if __name__ == "__main__":
    unittest.main()
