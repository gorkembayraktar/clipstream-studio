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

#: GPU ve GPU olmayan işler ayrı kuyruklarda tek tek çalışır.
GPU_LANE = "gpu"
CPU_LANE = "cpu"


class JobManager:
    """Bellek içi iş merkezi (tek kullanıcılı yerel uygulama için yeterlidir)."""

    def __init__(self, max_jobs: int = 50) -> None:
        self._jobs: dict[str, dict[str, Any]] = {}
        self._max_jobs = max_jobs

    # ------------------------------------------------------------------ CRUD
    def create(self, payload: dict[str, Any], lang: str = "en") -> dict[str, Any]:
        self._prune()
        #: Kulvar istemcinin render tercihinden gelir; GPU ve CPU kuyrukları
        #: birbirini beklemeden kendi içinde sırayla çalışır.
        lane = (
            GPU_LANE
            if str(payload.get("encoder", CPU_LANE)).strip().lower() == GPU_LANE
            else CPU_LANE
        )
        job: dict[str, Any] = {
            "id": uuid.uuid4().hex[:8],
            "status": PENDING,
            "progress": 0.0,
            "created_at": time.time(),
            "payload": payload,
            #: Kuyrukta beklerken kartta gösterilecek hedef dosya adı; gerçek
            #: çıktı adı (zaman damgası/çakışma ekiyle) iş başlayınca yazılır.
            "requested_filename": str(payload.get("filename", "")).strip() or None,
            #: İşin oluşturulduğu arayüz dili: arka plan hataları bu dilde üretilir.
            "lang": lang,
            "lane": lane,
        }
        self._jobs[job["id"]] = job
        return job

    def get(self, job_id: str) -> Optional[dict[str, Any]]:
        return self._jobs.get(job_id)

    def queue_position(self, job: dict[str, Any]) -> Optional[int]:
        """Bekleyen işin kendi kulvarındaki 1 tabanlı sırasını verir.

        Çalışan ya da bitmiş işler için `None` döner. Sıra, oluşturulma
        zamanına göre hesaplanır; böylece aynı kulvardaki işler FIFO çalışır.
        """
        if job["status"] != PENDING:
            return None
        lane = job.get("lane", CPU_LANE)
        waiting = sorted(
            (
                other
                for other in self._jobs.values()
                if other["status"] == PENDING
                and other.get("lane", CPU_LANE) == lane
            ),
            key=lambda other: other["created_at"],
        )
        for position, other in enumerate(waiting, start=1):
            if other is job:
                return position
        return None

    def list_jobs(self, active_only: bool = False) -> list[dict[str, Any]]:
        """İşleri oluşturulma sırasına göre döndürür (en eski önce).

        `active_only` yalnızca süren işleri (pending/running) bırakır;
        sayfa yenilendiğinde pano bu listeyle geri yüklenir.
        """
        jobs = self._jobs.values()
        if active_only:
            jobs = (
                job for job in jobs if job["status"] not in TERMINAL_STATUSES
            )
        return sorted(jobs, key=lambda job: job["created_at"])

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
    def public_view(self, job: dict[str, Any]) -> dict[str, Any]:
        """Serileştirilemez alanları (süreç nesnesi, ham yük) ayıklar."""
        view = {
            key: value
            for key, value in job.items()
            if key not in {"process", "payload", "lang"}
        }
        # Kuyrukta bekleyen işte run_export_job henüz çalışmadığı için kartın
        # biçim/aralık bilgisini istekten türet; çalışınca gerçek değerler
        # exporter tarafından yazılır ve setdefault bunları ezmez.
        payload = job.get("payload", {})
        view.setdefault(
            "output_format", str(payload.get("output_format", "mp4")).lower()
        )
        view.setdefault("mode", str(payload.get("mode", "exact")).lower())
        if payload.get("quality") is not None:
            view.setdefault("quality", payload["quality"])
        if payload.get("codec") is not None:
            view.setdefault("codec", payload["codec"])
        view.setdefault("output_fps", payload.get("output_fps"))
        segments = payload.get("segments") or []
        if segments:
            view.setdefault("clip_start", segments[0].get("start_time"))
            view.setdefault("clip_end", segments[-1].get("end_time"))
        else:
            view.setdefault("clip_start", payload.get("start_time"))
            view.setdefault("clip_end", payload.get("end_time"))
        position = self.queue_position(job)
        if position is not None:
            view["queue_position"] = position
        return view

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
