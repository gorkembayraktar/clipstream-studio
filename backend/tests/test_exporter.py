"""Dışa aktarma komutu ve GPU kodlayıcı seçimi için birim testleri."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.exporter import (  # noqa: E402
    ExportError,
    _parse_speed,
    _update_eta,
    build_ffmpeg_command,
    is_gpu_render_eligible,
    select_gpu_encoder,
    stage_hls_sources,
)
from services.segment_downloader import DownloadedMedia  # noqa: E402
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

    def test_staged_inputs_use_separate_relative_seek_values(self):
        payload = make_payload(
            url="https://example.com/video.m3u8",
            audio_url="https://example.com/audio.m3u8",
            start_time=5203.334,
            end_time=5305.493,
            _video_seek=3.334,
            _audio_seek=1.2,
        )
        command = build_ffmpeg_command(payload, Path("out.mp4"))
        seek_values = [
            command[index + 1]
            for index, value in enumerate(command)
            if value == "-ss"
        ]
        self.assertEqual(seek_values, ["00:00:03.334", "00:00:01.200"])

    def test_local_staged_audio_path_is_kept(self):
        with tempfile.TemporaryDirectory() as root:
            audio = Path(root) / "audio.bin"
            audio.write_bytes(b"audio")
            command = build_ffmpeg_command(
                make_payload(url="https://example.com/video.m3u8", audio_url=str(audio)),
                Path("out.mp4"),
            )
            self.assertIn(str(audio), command)
            self.assertIn("1:a:0", command)


class EtaTests(unittest.TestCase):
    def test_parse_speed(self):
        self.assertEqual(_parse_speed("1.25x"), 1.25)
        self.assertEqual(_parse_speed(" 2.0X "), 2.0)
        self.assertIsNone(_parse_speed("N/A"))
        self.assertIsNone(_parse_speed("0x"))
        self.assertIsNone(_parse_speed(None))

    def test_eta_uses_remaining_duration_and_speed(self):
        job = {"current_sec": 10.0, "speed": "2.0x"}
        _update_eta(job, 30.0)
        self.assertEqual(job["eta_sec"], 10.0)

    def test_eta_is_removed_without_speed(self):
        job = {"current_sec": 10.0, "speed": "N/A", "eta_sec": 12.0}
        _update_eta(job, 30.0)
        self.assertNotIn("eta_sec", job)

    def test_eta_is_zero_when_clip_is_finished(self):
        job = {"current_sec": 30.0, "speed": "1.5x"}
        _update_eta(job, 30.0)
        self.assertEqual(job["eta_sec"], 0.0)

    def test_eta_does_not_go_negative(self):
        job = {"current_sec": 31.0, "speed": "1.5x"}
        _update_eta(job, 30.0)
        self.assertEqual(job["eta_sec"], 0.0)


class StagingTests(unittest.IsolatedAsyncioTestCase):
    async def test_video_and_audio_are_localized_with_relative_seeks(self):
        video = DownloadedMedia(
            path=Path("video-range.bin"),
            temp_dir=Path("video-temp"),
            duration=110.0,
            segment_count=11,
            start=5200.0,
        )
        audio = DownloadedMedia(
            path=Path("audio-range.bin"),
            temp_dir=Path("audio-temp"),
            duration=112.0,
            segment_count=11,
            start=5198.0,
        )
        payload = make_payload(
            url="https://example.com/video.m3u8",
            audio_url="https://example.com/audio.m3u8",
            start_time=5203.334,
            end_time=5305.493,
        )

        with patch(
            "services.exporter.download_hls_range",
            new=AsyncMock(side_effect=[video, audio]),
        ) as download:
            staged, downloads = await stage_hls_sources(
                payload, object(), 5203.334, 5305.493
            )

        self.assertEqual(download.await_count, 2)
        self.assertEqual(staged["url"], "video-range.bin")
        self.assertEqual(staged["audio_url"], "audio-range.bin")
        self.assertAlmostEqual(staged["_video_seek"], 3.334)
        self.assertAlmostEqual(staged["_audio_seek"], 5.334)
        self.assertEqual(downloads, [video, audio])
        # Girdi payload'u değişmemeli; yalnızca kopya yerelleştirilir.
        self.assertEqual(payload["url"], "https://example.com/video.m3u8")

    async def test_failed_staging_keeps_original_remote_urls(self):
        payload = make_payload(
            url="https://example.com/video.m3u8",
            audio_url="https://example.com/audio.m3u8",
        )
        with patch(
            "services.exporter.download_hls_range",
            new=AsyncMock(return_value=None),
        ):
            staged, downloads = await stage_hls_sources(
                payload, object(), 1.25, 4.75
            )

        self.assertEqual(staged, payload)
        self.assertEqual(downloads, [])


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
