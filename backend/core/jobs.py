"""Arka planda çalışan dışa aktarma işlerinin merkezî yönetimi."""
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from core.i18n import t

PENDING = "pending"
RUNNING = "running"
DONE = "done"
ERROR = "error"
CANCELLED = "cancelled"

TERMINAL_STATUSES = {DONE, ERROR, CANCELLED}


class JobManager:
    """Bellek içi iş merkezi (tek kullanıcılı yerel uygulama için yeterlidir)."""

    def __init__(self, max_jobs: int = 50) -> None:
        self._jobs: dict[str, dict[str, Any]] = {}
        self._max_jobs = max_jobs

    # ------------------------------------------------------------------ CRUD
    def create(self, payload: dict[str, Any], lang: str = "en") -> dict[str, Any]:
        self._prune()
        job: dict[str, Any] = {
            "id": uuid.uuid4().hex[:8],
            "status": PENDING,
            "progress": 0.0,
            "created_at": time.time(),
            "payload": payload,
            #: İşin oluşturulduğu arayüz dili: arka plan hataları bu dilde üretilir.
            "lang": lang,
        }
        self._jobs[job["id"]] = job
        return job

    def get(self, job_id: str) -> Optional[dict[str, Any]]:
        return self._jobs.get(job_id)

    def cancel(self, job: dict[str, Any]) -> tuple[bool, str]:
        if job["status"] in TERMINAL_STATUSES:
            return False, t("error.jobFinished")

        process = job.get("process")
        if process is not None:
            try:
                process.kill()
            except Exception:
                pass

        job["status"] = CANCELLED
        job["progress"] = 0.0

        output_path = job.get("output_path")
        if output_path:
            path = Path(output_path)
            if path.exists():
                try:
                    path.unlink()
                except OSError:
                    pass

        return True, t("error.jobCancelled")

    # ------------------------------------------------------------- Görünümler
    @staticmethod
    def public_view(job: dict[str, Any]) -> dict[str, Any]:
        """Serileştirilemez alanları (süreç nesnesi, ham yük) ayıklar."""
        return {
            key: value
            for key, value in job.items()
            if key not in {"process", "payload", "lang"}
        }

    # ------------------------------------------------------------------ içsel
    def _prune(self) -> None:
        """Bellek şişmesini önlemek için eski bitmiş işleri temizler."""
        if len(self._jobs) < self._max_jobs:
            return
        finished = sorted(
            (job for job in self._jobs.values() if job["status"] in TERMINAL_STATUSES),
            key=lambda job: job["created_at"],
        )
        while finished and len(self._jobs) >= self._max_jobs:
            self._jobs.pop(finished.pop(0)["id"], None)
