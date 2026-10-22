"""Paralel waveform çıkarımı: kova hizalama ve tepe birleştirme testleri."""
import array
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.waveform import (  # noqa: E402
    _bucket_samples,
    _extract_parallel,
    _peaks_from_pcm,
    _to_u8,
)


class PeakBucketTests(unittest.TestCase):
    def test_partial_bucket_at_chunk_start_aligns_to_global_index(self):
        samples = array.array("h", [100, -200, 300, -400, 500, 600])

        peaks = _peaks_from_pcm(samples.tobytes(), bucket_samples=4, start_sample=2)

        self.assertEqual(peaks, {0: 200, 1: 600})

    def test_silent_pcm_still_records_zero_peak(self):
        samples = array.array("h", [0, 0, 0, 0])

        peaks = _peaks_from_pcm(samples.tobytes(), bucket_samples=4, start_sample=0)

        self.assertEqual(peaks, {0: 0})


class ParallelExtractionTests(unittest.IsolatedAsyncioTestCase):
    async def test_chunks_are_requested_in_order_and_peaks_merge_by_max(self):
        calls: list[tuple[float, float]] = []

        async def fake_range(source, start, length, bucket_samples):
            calls.append((start, length))
            if start == 0:
                return {0: 1000, 1: 500}
            if start == 5:
                return {1: 2000}
            return {47: 3000}

        with patch("services.waveform.WAVEFORM_CHUNK_SECONDS", 5), patch(
            "services.waveform._peaks_for_range", side_effect=fake_range
        ):
            buckets, processed = await _extract_parallel("dummy.bin", duration=12)

        self.assertEqual(calls, [(0, 5), (5, 5), (10, 2)])
        self.assertEqual(processed, 12)
        self.assertEqual(len(buckets), 48)
        self.assertEqual(buckets[0], _to_u8(1000))
        # İki parçanın aynı kovaya düşen tepelerinden büyüğü kullanılır.
        self.assertEqual(buckets[1], _to_u8(2000))
        self.assertEqual(buckets[47], _to_u8(3000))

    async def test_bucket_size_matches_total_duration(self):
        self.assertEqual(_bucket_samples(12), 2000)


if __name__ == "__main__":
    unittest.main()
