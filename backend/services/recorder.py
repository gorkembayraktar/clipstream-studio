"""Canlı HLS yayınlarını proje akışına segment segment ekler.

Neden segment segment:
    Canlı playlist'te FFmpeg'in `-ss` değeri yok sayılır ve süreç kapandığında
    "nerede kaldım" bilgisi kaybolur. Segment numarası (`EXT-X-MEDIA-SEQUENCE`)
    ise kalıcı bir konumdur: her segment indirildikçe akışa eklenir ve
    `state.json`'a yazılır; backend yeniden başlasa da kayıt aynı sıradan devam
    eder. Pencere kaydığı için kaçırılan segmentler `gaps` olarak raporlanır.

Dosya düzeni:
    cache/streams/<proje>/seg_000001.ts   akış segmenti (doğrudan oynatılır)
    cache/streams/<proje>/index.m3u8      HLS playlist (kayıtla büyür)
    cache/recordings/<kayıt>/state.json   yalnızca süren kaydın durumu

Durdurmak bir dönüştürme işi başlatmaz: segmentler zaten oynatılabilir HLS
parçalarıdır, kayıt anında akışın parçası olur. Böylece "MP4'e çevir →
birleştir → oynatıcıyı yeniden bağla" zinciri tamamen kalkar.

Bilinen sınır: video ile ayrı gelen ses akışı (ör. bazı YouTube canlı yayınları)
kayda eklenmez; yalnızca video URL'sindeki ses kaydedilir.
"""
import asyncio
import json
import logging
import secrets
import shutil
import time
from typing import Any, Optional

from config import RECORDINGS_DIR, RECORDINGS_MAX_BYTES, RECORDINGS_MAX_SECONDS
from core.i18n import current_language, set_language, t
from services import streams
from services.header_store import get_headers
from services.request_headers import sanitize_headers
from services.segment_downloader import MediaPlaylist, load_export_playlist

logger = logging.getLogger(__name__)

STATE_FILE = "state.json"
STATE_VERSION = 2

#: Tek segment indirme denemesi sayısı (CDN dalgalanmalarına karşı).
SEGMENT_RETRIES = 3
#: Playlist yoklama aralığı (sn). `EXT-X-TARGETDURATION` varsa ona uyulur.
MIN_POLL = 1.5
MAX_POLL = 12.0
#: Art arda bu kadar playlist hatasından sonra kayıt duraklar.
MAX_PLAYLIST_FAILURES = 20

#: Arayüze dönen alanlar (başlıklar ve yerel yollar sızdırılmaz).
PUBLIC_FIELDS = (
    "id",
    "title",
    "status",
    "created_at",
    "updated_at",
    "duration",
    "segments",
    "bytes",
    "gaps",
    "error",
    "limit_reached",
    "project_id",
    "stream_id",
)


class RecordingError(RuntimeError):
    """Kayıt başlatılamadı/çalıştırılamadı (kullanıcıya gösterilebilir)."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _now() -> float:
    return time.time()


def _poll_interval(playlist: MediaPlaylist) -> float:
    """Yeni segmentin yayınlanmasını beklemek için uygun aralık."""
    target = playlist.target_duration or 0.0
    if target > 0:
        return max(MIN_POLL, min(MAX_POLL, target))
    return max(MIN_POLL, min(MAX_POLL, playlist.segments[-1].duration if playlist.segments else 2.0))


class RecorderManager:
    """Süren kayıtların defteri + segment yakalama döngüleri.

    Bitmiş kayıtlar burada tutulmaz: onlar artık akışın bloklarıdır
    (`services.streams`). Bu yönetici yalnızca `recording`/`paused` durumunu
    bilir; böylece "hazır kayıt listesi" diye ikinci bir doğru kalmaz.
    """

    def __init__(self) -> None:
        self._records: dict[str, dict[str, Any]] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._client: Any = None

    # ------------------------------------------------------------- yaşam döngüsü
    def bind(self, client: Any) -> None:
        """HTTP istemcisini bağlar (Starlette `app.state.http`)."""
        self._client = client

    async def restore(self) -> None:
        """Sunucu açılışında diskteki süren kayıtları yükler.

        `recording` durumundaki kayıtlar kaldığı segmentten devam eder; bitmiş
        (eski sürüm) kayıtlar yüklenmez, akış zaten segmentleri taşır.
        """
        if not RECORDINGS_DIR.exists():
            return

        for entry in sorted(RECORDINGS_DIR.iterdir()):
            state_path = entry / STATE_FILE
            if not entry.is_dir() or not state_path.is_file():
                continue
            try:
                record = json.loads(state_path.read_text("utf-8"))
            except Exception:
                logger.warning("recorder: okunamayan durum dosyası: %s", state_path)
                continue
            record_id = str(record.get("id") or "")
            if not record_id or record_id != entry.name:
                logger.warning("recorder: kimlik uyuşmuyor, atlandı: %s", entry)
                continue

            # Eski sürüm kayıtları (segmentleri akışa yazmayan) yüklenmez.
            if not record.get("stream_id"):
                logger.info("recorder: eski sürüm kayıt atlandı (%s)", record_id)
                continue

            self._records[record_id] = record
            if record.get("status") == "recording":
                logger.info("recorder: kayıt devam ediyor (%s)", record_id)
                self._spawn_capture(record)

    async def shutdown(self) -> None:
        """Sunucu kapanırken döngüleri sessizce durdurur (durum diskte kalır)."""
        for record_id in list(self._tasks):
            await self._cancel(record_id)

    # ------------------------------------------------------------------ listeleme
    def list(self) -> list[dict[str, Any]]:
        records = sorted(
            self._records.values(),
            key=lambda item: float(item.get("created_at") or 0),
        )
        return [self.public(record) for record in records]

    def public(self, record: dict[str, Any]) -> dict[str, Any]:
        data = {key: record.get(key) for key in PUBLIC_FIELDS}
        data["size_mb"] = round(float(record.get("bytes") or 0) / (1024 * 1024), 2)
        return data

    def get(self, record_id: str) -> dict[str, Any]:
        return self.public(self._require(record_id))

    def active_for(self, stream_id: str) -> Optional[dict[str, Any]]:
        for record in self._records.values():
            if record.get("stream_id") == stream_id and record.get("status") in (
                "recording",
                "paused",
            ):
                return self.public(record)
        return None

    # ------------------------------------------------------------------- eylemler
    async def start(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Yeni kayıt başlatır; kaynak canlı HLS olmalıdır."""
        url = str(payload.get("url") or "").strip()
        if not url.startswith(("http://", "https://")):
            raise RecordingError(t("error.sourceRequired"))

        project_id = str(payload.get("project_id") or "").strip()
        if not streams.valid_id(project_id):
            raise RecordingError(t("error.recordProjectMissing"))

        if self.active_for(project_id) is not None:
            raise RecordingError(t("error.recordBusy"), 409)

        headers = {
            **get_headers(payload.get("header_token")),
            **sanitize_headers(payload.get("headers")),
        }
        playlist = await self._load_playlist(url, headers)
        if playlist is None:
            raise RecordingError(t("error.recordUnsupported"), 415)
        if playlist.endlist:
            raise RecordingError(t("error.recordNotLive"), 409)

        record_id = f"rec_{secrets.token_hex(8)}"
        title = str(payload.get("title") or "").strip() or t("record.defaultTitle")
        record: dict[str, Any] = {
            "version": STATE_VERSION,
            "id": record_id,
            "title": title,
            "status": "recording",
            "url": url,
            "media_url": playlist.url,
            "headers": headers,
            "created_at": _now(),
            "updated_at": _now(),
            "duration": 0.0,
            "segments": 0,
            "bytes": 0,
            "gaps": 0,
            "error": None,
            "limit_reached": False,
            "lang": current_language(),
            "project_id": project_id,
            # Kayıt nereye yazıldığı: segmentler proje akışına eklenir.
            "stream_id": project_id,
        }

        directory = RECORDINGS_DIR / record_id
        directory.mkdir(parents=True, exist_ok=True)
        self._records[record_id] = record
        self._persist(record)
        self._spawn_capture(record)
        logger.info("recorder: kayıt başladı (%s → %s)", record_id, project_id)
        return self.public(record)

    async def stop(self, record_id: str) -> Optional[dict[str, Any]]:
        """Yakalamayı durdurur; segmentler zaten akışın içinde.

        Kayıt zaten bitmişse (başka sekmede durduruldu) sessizce `None` döner:
        düğmeye ikinci kez basmak hata göstermez.
        """
        record = self._records.get(record_id)
        if record is None:
            return None

        await self._cancel(record_id)
        record["status"] = "stopped"
        record["updated_at"] = _now()
        data = self.public(record)
        self._forget(record_id)
        logger.info("recorder: kayıt durdu (%s)", record_id)
        return data

    async def pause(self, record_id: str) -> dict[str, Any]:
        """Yakalamayı duraklatır: `resume` akışa eklemeye devam eder."""
        record = self._require(record_id)
        if record.get("status") != "recording":
            return self.public(record)

        await self._cancel(record_id)
        record["status"] = "paused"
        record["updated_at"] = _now()
        self._persist(record)
        return self.public(record)

    async def resume(self, record_id: str) -> dict[str, Any]:
        """Duraklatılmış kaydı aynı akışa devam ettirir."""
        record = self._require(record_id)
        record["status"] = "recording"
        record["error"] = None
        record["limit_reached"] = False
        record["updated_at"] = _now()
        self._persist(record)
        self._spawn_capture(record)
        return self.public(record)

    async def delete(self, record_id: str) -> dict[str, Any]:
        """Süren kaydı iptal eder; segmentleri akıştan silmez (çağıran siler)."""
        record = self._require(record_id)
        await self._cancel(record_id)
        self._forget(record_id)
        return self.public(record)

    async def abandon(self, stream_id: str, record_id: str) -> None:
        """Akıştan silinecek kayıt hâlâ sürüyorsa yakalamayı bırakır."""
        record = self._records.get(record_id)
        if record is None:
            return
        await self._cancel(record_id)
        self._forget(record_id)

    # ------------------------------------------------------------------- iç işler
    def _require(self, record_id: str) -> dict[str, Any]:
        record = self._records.get(record_id)
        if record is None:
            raise RecordingError(t("error.recordingNotFound"), 404)
        return record

    def _forget(self, record_id: str) -> None:
        self._records.pop(record_id, None)
        directory = RECORDINGS_DIR / record_id
        try:
            shutil.rmtree(directory, ignore_errors=True)
        except OSError:
            pass

    async def _load_playlist(
        self, url: str, headers: Optional[dict[str, str]]
    ) -> Optional[MediaPlaylist]:
        try:
            return await load_export_playlist(self._client, url, headers)
        except Exception as exc:  # ağ/playlist hatası: çağıran karar verir
            logger.info("recorder: playlist okunamadı: %s", exc)
            return None

    def _spawn_capture(self, record: dict[str, Any]) -> None:
        record_id = str(record["id"])
        task = self._tasks.get(record_id)
        if task is not None and not task.done():
            return
        self._tasks[record_id] = asyncio.create_task(
            self._capture(record), name=f"recorder-{record_id}"
        )

    async def _cancel(self, record_id: str) -> None:
        task = self._tasks.pop(record_id, None)
        if task is None or task.done():
            return
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    def _persist(self, record: dict[str, Any]) -> None:
        """Durumu atomik yazar: çökme anında yarım JSON kalmaz."""
        state = {key: value for key, value in record.items()}
        directory = RECORDINGS_DIR / str(record["id"])
        try:
            directory.mkdir(parents=True, exist_ok=True)
            target = directory / STATE_FILE
            temp = directory / f"{STATE_FILE}.tmp"
            temp.write_text(
                json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8"
            )
            temp.replace(target)
        except OSError as exc:
            logger.warning("recorder: durum yazılamadı: %s", exc)

    async def _capture(self, record: dict[str, Any]) -> None:
        """Yeni segmentleri sırayla indirip proje akışına ekler."""
        set_language(record.get("lang"))
        record_id = str(record["id"])
        stream_id = str(record["stream_id"])
        title = str(record.get("title") or record_id)
        headers = record.get("headers") or None
        failures = 0

        try:
            while True:
                playlist = await self._load_playlist(
                    str(record.get("media_url") or record.get("url")), headers
                )
                if playlist is None:
                    failures += 1
                    if failures == 5:
                        # Önbellekteki varyant adresi eskimiş olabilir (CDN
                        # jetonu): master'dan yeniden çözülsün.
                        record["media_url"] = None
                    if failures >= MAX_PLAYLIST_FAILURES:
                        record["status"] = "paused"
                        record["error"] = t("error.recordPlaylistLost")
                        record["updated_at"] = _now()
                        self._persist(record)
                        logger.warning("recorder: playlist kayboldu (%s)", record_id)
                        return
                    await asyncio.sleep(MIN_POLL * 2)
                    continue

                failures = 0
                if not record.get("media_url") and playlist.url:
                    record["media_url"] = playlist.url

                last = record.get("last_sequence")
                if isinstance(last, int):
                    pending = [
                        segment
                        for segment in playlist.segments
                        if segment.sequence is not None and segment.sequence > last
                    ]
                else:
                    # Yeni kayıt: pencere başından değil **canlı uçtan** başla.
                    # DVR penceresinin tamamını (ör. 24 saat) indirmek istemiyoruz.
                    newest = max(
                        (
                            segment.sequence
                            for segment in playlist.segments
                            if segment.sequence is not None
                        ),
                        default=None,
                    )
                    pending = [
                        segment
                        for segment in playlist.segments
                        if newest is not None and segment.sequence == newest
                    ]
                if not pending:
                    await asyncio.sleep(_poll_interval(playlist))
                    continue

                for segment in pending:
                    data = await self._download(segment.url, headers)
                    if data is None:
                        # Tek tek düşen segment kaydı kilitlemesin: boşluk say,
                        # sonraki segmentten devam et.
                        record["gaps"] = int(record.get("gaps") or 0) + 1
                        record["last_sequence"] = segment.sequence
                        record["updated_at"] = _now()
                        last = segment.sequence
                        self._persist(record)
                        continue

                    try:
                        await streams.append(
                            stream_id,
                            data=data,
                            duration=float(segment.duration or 0.0),
                            recording_id=record_id,
                            title=title,
                            source_sequence=segment.sequence,
                            created_at=float(record.get("created_at") or _now()),
                        )
                    except streams.StreamError as exc:
                        record["status"] = "paused"
                        record["error"] = str(exc)
                        record["updated_at"] = _now()
                        self._persist(record)
                        return

                    if isinstance(last, int) and segment.sequence is not None:
                        missed = segment.sequence - last - 1
                        if missed > 0:
                            record["gaps"] = int(record.get("gaps") or 0) + missed
                    record["last_sequence"] = segment.sequence
                    record["segments"] = int(record.get("segments") or 0) + 1
                    record["bytes"] = int(record.get("bytes") or 0) + len(data)
                    record["duration"] = round(
                        float(record.get("duration") or 0.0)
                        + max(0.0, float(segment.duration or 0.0)),
                        3,
                    )
                    record["updated_at"] = _now()
                    last = record["last_sequence"]
                    self._persist(record)

                    if self._limit_reached(record):
                        record["limit_reached"] = True
                        record["status"] = "stopped"
                        record["updated_at"] = _now()
                        logger.info("recorder: sınıra ulaşıldı, kayıt durdu (%s)", record_id)
                        self._forget(record_id)
                        return
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # beklenmedik hata: kaydı kaybetme, duraklat
            logger.exception("recorder: kayıt hatası (%s): %s", record_id, exc)
            record["status"] = "paused"
            record["error"] = t("error.recordFailed", detail=exc)
            record["updated_at"] = _now()
            self._persist(record)

    def _limit_reached(self, record: dict[str, Any]) -> bool:
        return (
            float(record.get("duration") or 0.0) >= RECORDINGS_MAX_SECONDS
            or int(record.get("bytes") or 0) >= RECORDINGS_MAX_BYTES
        )

    async def _download(
        self, url: str, headers: Optional[dict[str, str]]
    ) -> Optional[bytes]:
        for attempt in range(SEGMENT_RETRIES):
            try:
                response = await self._client.get(url, headers=headers or None)
                if response.status_code < 400 and response.content:
                    return response.content
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.info("recorder: segment indirilemedi (%s): %s", url[-60:], exc)
            await asyncio.sleep(0.4 * (attempt + 1))
        return None


#: Uygulama genelinde tek yönetici (Starlette `app.state.recorder`).
manager = RecorderManager()
