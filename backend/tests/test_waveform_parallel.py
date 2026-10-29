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
    SAMPLE_RATE,
    _bucket_samples,
    _consume_stream,
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

    def test_multiple_buckets_are_reduced_in_one_pass(self):
        samples = array.array("h", [1, -2, 3, -4, 5, -6, 7, -8, 9])

        peaks = _peaks_from_pcm(samples.tobytes(), bucket_samples=4, start_sample=0)

        self.assertEqual(peaks, {0: 4, 1: 8, 2: 9})

    def test_int16_minimum_peak_does_not_overflow(self):
        # `-(-32768)` int16'da taşar; tepe 32768 olarak raporlanmalı.
        samples = array.array("h", [-32768, 0, 0, 0])

        peaks = _peaks_from_pcm(samples.tobytes(), bucket_samples=2, start_sample=0)

        self.assertEqual(peaks, {0: 32768, 1: 0})


class ConsumeStreamTests(unittest.IsolatedAsyncioTestCase):
    class _Stream:
        """Verilen baytları sabit boyutlu parçalar halinde sunar."""

        def __init__(self, data: bytes, size: int) -> None:
            self.data, self.size, self.pos = data, size, 0

        async def read(self, _size: int) -> bytes:
            chunk = self.data[self.pos:self.pos + self.size]
            self.pos += self.size
            return chunk

    async def test_buckets_span_uneven_chunks(self):
        # 7 baytlık parçalar örnek ve kova sınırlarına denk gelmiyor.
        payload = array.array("h", [10, -20, 30, -40, 50, -60, 70, -80, 90, -100])
        stream = self._Stream(payload.tobytes(), 7)

        buckets, seconds = await _consume_stream(stream, bucket_samples=4)

        self.assertEqual(
            list(buckets), [_to_u8(40), _to_u8(80), _to_u8(100)]
        )
        self.assertAlmostEqual(seconds, 10 / SAMPLE_RATE)

    async def test_complete_last_bucket_is_not_repeated(self):
        payload = array.array("h", [100, 100, 100, 100])
        stream = self._Stream(payload.tobytes(), 8)

        buckets, _seconds = await _consume_stream(stream, bucket_samples=4)

        self.assertEqual(list(buckets), [_to_u8(100)])


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
