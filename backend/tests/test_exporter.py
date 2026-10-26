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
    _build_concat_manifest,
    _build_concat_remux_command,
    _can_resume,
    _export_segments,
    _next_resume_offset,
    _parse_speed,
    _quality_profile,
    _resume_payload,
    _run_segmented_export,
    _segments_duration,
    _update_eta,
    build_ffmpeg_command,
    is_gpu_render_eligible,
    run_export_job,
    select_gpu_encoder,
    stage_hls_sources,
)
from core.jobs import ERROR, RUNNING  # noqa: E402
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

    def test_hevc_is_not_gpu_eligible(self):
        self.assertFalse(is_gpu_render_eligible("mp4", "exact", None, "hevc"))

    def test_output_fps_makes_fast_mode_gpu_eligible(self):
        self.assertTrue(
            is_gpu_render_eligible("mp4", "fast", None, "h264", 30)
        )


class FfmpegCommandTests(unittest.TestCase):
    def test_cpu_exact_uses_libx264(self):
        command = build_ffmpeg_command(make_payload(), Path("out.mp4"))
        self.assertIn("libx264", command)
        self.assertIn("-crf", command)
        self.assertNotIn("h264_nvenc", command)

    def test_default_quality_is_balanced(self):
        name, profile = _quality_profile(make_payload())
        self.assertEqual(name, "balanced")
        self.assertEqual(profile["crf"], 22)
        command = build_ffmpeg_command(make_payload(), Path("out.mp4"))
        self.assertEqual(command[command.index("-preset") + 1], "medium")
        self.assertEqual(command[command.index("-crf") + 1], "22")
        self.assertEqual(command[command.index("-b:a") + 1], "160k")

    def test_high_quality_preserves_previous_encoder_settings(self):
        command = build_ffmpeg_command(
            make_payload(quality="high"), Path("out.mp4")
        )
        self.assertEqual(command[command.index("-preset") + 1], "veryfast")
        self.assertEqual(command[command.index("-crf") + 1], "20")
        self.assertEqual(command[command.index("-b:a") + 1], "192k")

    def test_unknown_quality_falls_back_to_balanced(self):
        name, _profile = _quality_profile(make_payload(quality="unknown"))
        self.assertEqual(name, "balanced")

    def test_hevc_uses_libx265_and_hvc1_tag(self):
        command = build_ffmpeg_command(
            make_payload(codec="hevc"), Path("out.mp4")
        )
        self.assertIn("libx265", command)
        self.assertEqual(command[command.index("-tag:v") + 1], "hvc1")
        self.assertNotIn("libx264", command)

    def test_hevc_ignores_gpu_encoder(self):
        command = build_ffmpeg_command(
            make_payload(codec="hevc"),
            Path("out.mp4"),
            gpu_encoder="h264_nvenc",
        )
        self.assertIn("libx265", command)
        self.assertNotIn("h264_nvenc", command)

    def test_hevc_compact_uses_hevc_crf_profile(self):
        command = build_ffmpeg_command(
            make_payload(codec="hevc", quality="compact"), Path("out.mp4")
        )
        self.assertEqual(command[command.index("-preset") + 1], "medium")
        self.assertEqual(command[command.index("-crf") + 1], "27")

    def test_fast_mode_with_hevc_still_reencodes(self):
        command = build_ffmpeg_command(
            make_payload(mode="fast", codec="hevc"), Path("out.mp4")
        )
        self.assertIn("libx265", command)
        self.assertNotIn("copy", command)

    def test_output_fps_adds_filter(self):
        command = build_ffmpeg_command(
            make_payload(output_fps=30), Path("out.mp4")
        )
        self.assertIn("fps=30", " ".join(command))

    def test_hevc_intermediate_skips_hvc1_tag(self):
        command = build_ffmpeg_command(
            make_payload(codec="hevc"), Path("part.ts"), intermediate=True
        )
        self.assertIn("libx265", command)
        self.assertNotIn("-tag:v", command)

    def test_gpu_balanced_quality_uses_slower_nvenc_preset(self):
        command = build_ffmpeg_command(
            make_payload(quality="balanced"),
            Path("out.mp4"),
            gpu_encoder="h264_nvenc",
        )
        self.assertEqual(command[command.index("-preset") + 1], "p6")
        self.assertEqual(command[command.index("-cq") + 1], "22")

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
        self.assertIn("crop=640:360:0:0", " ".join(command))

    def test_exact_mode_resets_input_timestamps(self):
        command = build_ffmpeg_command(make_payload(), Path("out.mp4"))
        joined = " ".join(command)
        self.assertIn("setpts=PTS-STARTPTS", joined)
        self.assertIn("asetpts=PTS-STARTPTS", joined)

    def test_fast_copy_does_not_add_filters(self):
        command = build_ffmpeg_command(make_payload(mode="fast"), Path("out.mp4"))
        self.assertNotIn("PTS-STARTPTS", " ".join(command))

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


class ResumeCommandTests(unittest.TestCase):
    def test_intermediate_output_uses_mpegts_without_faststart(self):
        command = build_ffmpeg_command(
            make_payload(), Path("part.ts"), intermediate=True
        )
        self.assertIn("-f", command)
        self.assertEqual(command[command.index("-f") + 1], "mpegts")
        self.assertNotIn("+faststart", command)
        self.assertEqual(
            command[command.index("-avoid_negative_ts") + 1], "make_zero"
        )

    def test_resume_offset_does_not_repeat_content(self):
        self.assertAlmostEqual(
            _next_resume_offset(100.0, 10.25, 200.0), 110.25
        )
        self.assertEqual(_next_resume_offset(95.0, 10.0, 100.0), 100.0)

    def test_concat_manifest_uses_video_duration_directives(self):
        manifest = _build_concat_manifest(
            [(Path("part1.ts"), 2.0), (Path("part2.ts"), 1.25)]
        )
        self.assertIn("file 'part1.ts'\nduration 2.000000", manifest)
        self.assertIn("file 'part2.ts'\nduration 1.250000", manifest)

    def test_concat_remux_normalizes_timestamps(self):
        command = _build_concat_remux_command(
            Path("concat.txt"), Path("out.mp4"), 12.5, "h264"
        )
        joined = " ".join(command)
        self.assertIn("-fflags +genpts", joined)
        self.assertIn("-avoid_negative_ts make_zero", joined)
        self.assertIn("-c copy", joined)
        self.assertEqual(command[command.index("-t") + 1], "00:00:12.500")

    def test_concat_remux_tags_hevc(self):
        command = _build_concat_remux_command(
            Path("concat.txt"), Path("out.mp4"), 12.5, "hevc"
        )
        self.assertEqual(command[command.index("-tag:v") + 1], "hvc1")

    def test_resume_payload_adjusts_staged_seeks(self):
        payload = make_payload(
            start_time=100.0,
            end_time=200.0,
            _video_seek=5.0,
            _audio_seek=2.0,
        )
        part = _resume_payload(payload, 130.0, 30.0)
        self.assertEqual(part["start_time"], 130.0)
        self.assertEqual(part["end_time"], 200.0)
        self.assertAlmostEqual(part["_video_seek"], 35.0)
        self.assertAlmostEqual(part["_audio_seek"], 32.0)

    def test_can_resume_only_for_reencoded_mp4(self):
        self.assertTrue(_can_resume(make_payload()))
        self.assertFalse(_can_resume(make_payload(mode="fast")))
        self.assertTrue(
            _can_resume(
                make_payload(
                    mode="fast",
                    crop={"enabled": True, "x": 0, "y": 0, "width": 640, "height": 360},
                )
            )
        )
        self.assertFalse(_can_resume(make_payload(output_format="gif")))
        self.assertFalse(_can_resume(make_payload(output_format="mp3")))

    def test_can_resume_for_hevc_and_output_fps(self):
        self.assertTrue(_can_resume(make_payload(mode="fast", codec="hevc")))
        self.assertTrue(_can_resume(make_payload(mode="fast", output_fps=30)))


class SegmentPlanTests(unittest.TestCase):
    """Çoklu kesim planı: doğrulama, sıralama ve örtüşme kırpma."""

    def test_missing_segments_fall_back_to_single_range(self):
        self.assertEqual(_export_segments(make_payload()), [(1.25, 4.75)])

    def test_segments_are_sorted_and_overlaps_clipped(self):
        payload = make_payload(
            segments=[
                {"start_time": 30.0, "end_time": 40.0},
                {"start_time": 10.0, "end_time": 20.0},
                {"start_time": 19.0, "end_time": 25.0},
            ]
        )
        self.assertEqual(
            _export_segments(payload),
            [(10.0, 20.0), (20.0, 25.0), (30.0, 40.0)],
        )

    def test_invalid_segment_list_does_not_fall_back_to_window(self):
        # Boş/geçersiz liste tüm pencereyi dışa aktarmamalı: aksi halde
        # kesilen bölümler sessizce geri gelirdi.
        payload = make_payload(
            segments=[{"start_time": 10.0, "end_time": 10.001}]
        )
        self.assertEqual(_export_segments(payload), [])

    def test_non_dict_entries_are_ignored(self):
        payload = make_payload(
            segments=["nope", {"start_time": 5.0, "end_time": 6.0}]
        )
        self.assertEqual(_export_segments(payload), [(5.0, 6.0)])

    def test_segments_duration_sums_pieces(self):
        self.assertAlmostEqual(
            _segments_duration([(10.0, 20.0), (35.5, 40.0)]), 14.5
        )


class SegmentedExportTests(unittest.IsolatedAsyncioTestCase):
    """Çoklu kesim: parça başına ffmpeg + tek birleştirme."""

    def make_segmented_payload(self, **overrides):
        return make_payload(
            start_time=10.0,
            end_time=80.0,
            segments=[
                {"start_time": 10.0, "end_time": 20.0},
                {"start_time": 35.5, "end_time": 40.0},
            ],
            **overrides,
        )

    async def test_runs_one_ffmpeg_per_segment_and_merges(self):
        payload = self.make_segmented_payload(mode="fast")
        job = {"status": RUNNING}
        commands: list[tuple[list[str], float, float]] = []
        remux_commands: list[list[str]] = []
        manifests: list[str] = []

        async def fake_ffmpeg(command, job_state, total, progress_base=0.0):
            commands.append((command, total, progress_base))
            Path(command[-1]).write_bytes(b"ts")
            return 0, "", False

        async def fake_remux(command, job_state):
            remux_commands.append(command)
            concat_path = Path(command[command.index("-i") + 1])
            manifests.append(concat_path.read_text(encoding="utf-8"))
            Path(command[-1]).write_bytes(b"mp4")
            return 0, ""

        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "out.mp4"
            with patch(
                "services.exporter._run_ffmpeg", side_effect=fake_ffmpeg
            ), patch(
                "services.exporter._run_ffmpeg_remux", side_effect=fake_remux
            ), patch(
                "services.exporter._probe_video_duration",
                new=AsyncMock(return_value=None),
            ):
                returncode, _stderr = await _run_segmented_export(
                    payload, output, job
                )

        self.assertEqual(returncode, 0)
        self.assertEqual(len(commands), 2)
        self.assertEqual(job["segment_count"], 2)
        # İlerleme toplam süre (10 + 4.5 sn) üzerinden raporlanır.
        self.assertAlmostEqual(commands[0][1], 14.5)
        self.assertAlmostEqual(commands[1][1], 14.5)
        self.assertAlmostEqual(commands[0][2], 0.0)
        self.assertAlmostEqual(commands[1][2], 10.0)

        first, second = commands[0][0], commands[1][0]
        self.assertEqual(first[first.index("-ss") + 1], "00:00:10.000")
        self.assertEqual(first[first.index("-t") + 1], "00:00:10.000")
        self.assertEqual(second[second.index("-ss") + 1], "00:00:35.500")
        self.assertEqual(second[second.index("-t") + 1], "00:00:04.500")
        # Ara parçalar birleştirilebilir MPEG-TS olarak yazılır.
        self.assertEqual(first[first.index("-f") + 1], "mpegts")

        self.assertEqual(len(remux_commands), 1)
        remux = remux_commands[0]
        self.assertEqual(remux[remux.index("-t") + 1], "00:00:14.500")
        self.assertEqual(manifests[0].count("file '"), 2)
        self.assertIsNone(job.get("stage"))
        self.assertNotIn("segment_index", job)

    async def test_staged_seek_is_shifted_per_segment(self):
        payload = self.make_segmented_payload(_video_seek=3.0, mode="exact")
        job = {"status": RUNNING}
        commands: list[list[str]] = []

        async def fake_ffmpeg(command, job_state, total, progress_base=0.0):
            commands.append(command)
            Path(command[-1]).write_bytes(b"ts")
            return 0, "", False

        async def fake_remux(command, job_state):
            Path(command[-1]).write_bytes(b"mp4")
            return 0, ""

        with tempfile.TemporaryDirectory() as tmp:
            with patch(
                "services.exporter._run_ffmpeg", side_effect=fake_ffmpeg
            ), patch(
                "services.exporter._run_ffmpeg_remux", side_effect=fake_remux
            ), patch(
                "services.exporter._probe_video_duration",
                new=AsyncMock(return_value=None),
            ):
                await _run_segmented_export(
                    payload, Path(tmp) / "out.mp4", job
                )

        # Yerelleştirilmiş dosyada seek, parçanın kaynak başlangıcına kayar.
        self.assertEqual(commands[0][commands[0].index("-ss") + 1], "00:00:03.000")
        self.assertEqual(commands[1][commands[1].index("-ss") + 1], "00:00:28.500")

    async def test_multi_segment_requires_mp4_output(self):
        job = {
            "status": RUNNING,
            "payload": self.make_segmented_payload(output_format="gif"),
            "lang": "en",
        }
        await run_export_job(job, None)
        self.assertEqual(job["status"], ERROR)
        self.assertIn("MP4", job["error"])

    async def test_empty_segment_list_is_rejected(self):
        job = {
            "status": RUNNING,
            "payload": make_payload(segments=[]),
            "lang": "en",
        }
        await run_export_job(job, None)
        self.assertEqual(job["status"], ERROR)


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

    async def test_local_http_source_is_not_staged(self):
        payload = make_payload(
            url="http://127.0.0.1:8765/api/local/file/abc123",
        )
        with (
            patch("services.exporter.local_path", return_value=Path("local.mp4")),
            patch(
                "services.exporter.download_hls_range",
                new=AsyncMock(),
            ) as download,
        ):
            staged, downloads = await stage_hls_sources(
                payload, object(), 1.25, 4.75
            )

        download.assert_not_awaited()
        self.assertEqual(staged, payload)
        self.assertEqual(downloads, [])

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

    async def test_gpu_request_is_rejected_for_hevc(self):
        encoder, reason, detail, label = await select_gpu_encoder(
            make_payload(encoder="gpu", codec="hevc")
        )
        self.assertIsNone(encoder)
        self.assertIn("CPU", reason or "")
        self.assertIsNone(detail)
        self.assertIsNone(label)


if __name__ == "__main__":
    unittest.main()
