"""Kopyasız yerel kaynak jetonlarının sınırlı bellekte tutulması."""
import sys
import tempfile
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services import local_media  # noqa: E402


class FileRegistryTests(unittest.TestCase):
    def setUp(self):
        local_media._FILE_REGISTRY.clear()
        self.addCleanup(local_media._FILE_REGISTRY.clear)

    def test_registry_evicts_oldest_tokens(self):
        # Uzun bir oturumda her "Gözat" yeni jeton ekler; kayıt sınırsız
        # büyürse sunucu belleği yavaşça şişer.
        limit = local_media._FILE_REGISTRY_LIMIT
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = root / "first.mp4"
            first.write_bytes(b"x")
            oldest = local_media.register_local_file(first)
            self.assertEqual(local_media.registered_file(oldest), first)

            for index in range(limit):
                extra = root / f"f{index}.mp4"
                extra.write_bytes(b"x")
                local_media.register_local_file(extra)

        self.assertEqual(len(local_media._FILE_REGISTRY), limit)
        # En eski jeton düşer, en yenisi kalır.
        self.assertIsNone(local_media._FILE_REGISTRY.get(oldest))
        newest = next(reversed(local_media._FILE_REGISTRY))
        self.assertIsNotNone(local_media._FILE_REGISTRY.get(newest))


if __name__ == "__main__":
    unittest.main()
