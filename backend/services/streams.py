"""Proje akışı: kayıtların ard arda eklendiği tek HLS akışı.

Neden segment + playlist:
    Kayıtlar canlı yayından zaten **segment segment** indiriliyor. Bu segmentler
    doğrudan bir HLS akışına yazıldığında birleştirme (concat/remux) gerekmez:
    her yeni segment playlist'e eklenir, oynatıcı aynı akışı sürdürür. Süre,
    konum ve kesimler tek bir kaynaktan (segment listesi) gelir; önceki
    çoklu-MP4 birleştirme kipi tamamen kalkmıştır.

Dosya düzeni:
    cache/streams/<akış>/index.json   segment listesi + süre/boyut + probe
    cache/streams/<akış>/index.m3u8   tarayıcı ve ffmpeg için HLS playlist
    cache/streams/<akış>/seg_000001.ts

Playlist bir **EVENT** playlist'tir (`EXT-X-PLAYLIST-TYPE:EVENT`, `ENDLIST` yok):
kayıt sürerken segmentler eklendikçe liste büyür, oynatıcı listeyi yoklayarak
yeni segmentleri kendiliğinden alır. Bu yüzden kayıt durunca video yeniden
yüklenmez (kara kare yok); akış tek bir yayın gibi akmaya devam eder.
Pencere kaymaz (start sequence sabit), yani geçmiş her zaman seek edilebilir.
Yalnızca yıkıcı değişimde (blok silme) liste yeniden yazılır ve arayüz
`playback` sayacıyla oynatıcıyı tazeler.

Akış kimliği proje kimliğidir: kayıtlar projeye özeldir ve proje açıldığında
akış kimliğiyle doğrudan yüklenir (canlı URL'nin yeniden çözülmesi gerekmez).
"""
import asyncio
import json
import logging
import math
import re
import time
from pathlib import Path
from typing import Any, Optional

from config import HOST, PORT, STREAMS_DIR, STREAMS_ROUTE
from core.i18n import t
from services.prober import ProbeError, probe_url

logger = logging.getLogger(__name__)

INDEX_FILE = "index.json"
PLAYLIST_FILE = "index.m3u8"
#: ffmpeg/ffprobe için sonlu kopya (`ENDLIST`); tarayıcı bunu görmez.
VOD_PLAYLIST_FILE = "index.vod.m3u8"
SEGMENT_PREFIX = "seg_"
SEGMENT_EXTENSION = ".ts"
INDEX_VERSION = 1

#: Akış kimliği URL'de ve klasör adında kullanılır (proje kimliği UUID'dir).
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

#: Aynı akışa eşzamanlı yazmayı engelleyen kilitler.
_LOCKS: dict[str, asyncio.Lock] = {}

#: Bellekteki akış defteri (disk asıl kaynaktır; bu yalnızca önbellek).
_RECORDS: dict[str, dict[str, Any]] = {}


class StreamError(RuntimeError):
    """Kullanıcıya gösterilebilir akış hatası."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


# ------------------------------------------------------------------ adresler
def valid_id(stream_id: Any) -> bool:
    return isinstance(stream_id, str) and bool(ID_PATTERN.match(stream_id))


def stream_dir(stream_id: str) -> Path:
    return STREAMS_DIR / stream_id


def playlist_path(stream_id: str) -> Path:
    return stream_dir(stream_id) / PLAYLIST_FILE


def vod_playlist_path(stream_id: str) -> Path:
    """Yerel araçların (ffmpeg/ffprobe) okuduğu sonlu playlist."""
    return stream_dir(stream_id) / VOD_PLAYLIST_FILE


def index_path(stream_id: str) -> Path:
    return stream_dir(stream_id) / INDEX_FILE


def segment_path(stream_id: str, file_name: str) -> Optional[Path]:
    """Playlist dosya adını güvenli bir yola çevirir (yol kaçırma engellenir)."""
    if not valid_id(stream_id):
        return None
    if file_name == PLAYLIST_FILE:
        return playlist_path(stream_id)
    if not re.fullmatch(r"seg_\d{6}\.ts", file_name):
        return None
    return stream_dir(stream_id) / file_name


def playlist_url(stream_id: str) -> str:
    return f"http://{HOST}:{PORT}{STREAMS_ROUTE}/{stream_id}/{PLAYLIST_FILE}"


def _segment_number(segment: dict[str, Any]) -> int:
    """`seg_000123.ts` → 123 (bozuksa 0)."""
    name = Path(str(segment.get("file") or "")).name
    if not name.startswith(SEGMENT_PREFIX):
        return 0
    stem = name[len(SEGMENT_PREFIX) : -len(SEGMENT_EXTENSION)]
    try:
        return int(stem)
    except ValueError:
        return 0


def _lock(stream_id: str) -> asyncio.Lock:
    lock = _LOCKS.get(stream_id)
    if lock is None:
        lock = asyncio.Lock()
        _LOCKS[stream_id] = lock
    return lock


# ------------------------------------------------------------------- defter
def _empty(stream_id: str, project_id: Optional[str], title: Optional[str]) -> dict[str, Any]:
    now = time.time()
    return {
        "version": INDEX_VERSION,
        "id": stream_id,
        "project_id": project_id or stream_id,
        "title": (title or "").strip() or None,
        "created_at": now,
        "updated_at": now,
        "segments": [],
        "probe": None,
        # Yıkıcı değişim (blok silme) sayacı: oynatma adresi buna göre tazelenir.
        "playback": 0,
    }


def load(stream_id: str) -> Optional[dict[str, Any]]:
    """Akış defterini döner (bellek → disk). Yoksa `None`."""
    if not valid_id(stream_id):
        return None

    cached = _RECORDS.get(stream_id)
    if cached is not None:
        return cached

    path = index_path(stream_id)
    if not path.is_file():
        return None

    try:
        record = json.loads(path.read_text("utf-8"))
    except Exception:
        logger.warning("streams: okunamayan dizin dosyası: %s", path)
        return None

    if not isinstance(record, dict) or not isinstance(record.get("segments"), list):
        logger.warning("streams: geçersiz dizin dosyası: %s", path)
        return None

    record.setdefault("version", INDEX_VERSION)
    record.setdefault("id", stream_id)
    record.setdefault("created_at", time.time())
    record.setdefault("updated_at", record["created_at"])
    record.setdefault("probe", None)
    record.setdefault("playback", 0)
    _RECORDS[stream_id] = record
    # Eski kayıtlarda playlist VOD'dur (`ENDLIST`). Oynatıcı büyüyen akışı
    # izleyebilsin diye EVENT listesine (ve ffmpeg için sonlu kopyaya) çevrilir.
    _ensure_playlist_format(record)
    return record


def _ensure_playlist_format(record: dict[str, Any]) -> None:
    """Playlist dosyaları eski biçimdeyse (VOD/eksik) yeniden üretir."""
    stream_id = str(record["id"])
    target = playlist_path(stream_id)
    try:
        text = target.read_text("utf-8") if target.is_file() else ""
    except OSError:
        text = ""
    if "#EXT-X-PLAYLIST-TYPE:EVENT" in text and vod_playlist_path(stream_id).is_file():
        return
    _write_playlist(record)


def _save(record: dict[str, Any]) -> None:
    stream_id = str(record["id"])
    directory = stream_dir(stream_id)
    try:
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / INDEX_FILE
        temp = directory / f"{INDEX_FILE}.tmp"
        temp.write_text(
            json.dumps(record, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        temp.replace(target)
    except OSError as exc:
        logger.warning("streams: dizin yazılamadı: %s", exc)


def _reindex(record: dict[str, Any]) -> None:
    """Segmentlerin akış başlangıç konumlarını yeniden hesaplar."""
    cursor = 0.0
    for segment in record["segments"]:
        duration = max(0.0, float(segment.get("duration") or 0.0))
        segment["start"] = round(cursor, 3)
        segment["end"] = round(cursor + duration, 3)
        cursor += duration
    record["duration"] = round(cursor, 3)


def _write_atomic(target: Path, lines: list[str]) -> None:
    temp = target.with_name(target.name + ".tmp")
    temp.write_text("\n".join(lines) + "\n", encoding="utf-8")
    temp.replace(target)


def _write_playlist(record: dict[str, Any]) -> None:
    """Segment listesinden iki playlist üretir (kopya yok, yerinde yazılır).

    * `index.m3u8` — büyüyen **EVENT** liste: `ENDLIST` yoktur. Tarayıcı hedef
      süre aralığıyla yoklar ve yeni segmentleri kesintisiz ekler; kayıt durunca
      oynatıcı yeniden bağlanmaz.
    * `index.vod.m3u8` — aynı segmentler + `ENDLIST`. ffmpeg/ffprobe bu sonlu
      kopyayı okur; EVENT listeyi canlı yayın sanıp sonsuza dek beklemez.
    """
    stream_id = str(record["id"])
    segments = record["segments"]
    target = playlist_path(stream_id)
    vod_target = vod_playlist_path(stream_id)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        if not segments:
            target.unlink(missing_ok=True)
            vod_target.unlink(missing_ok=True)
            return

        longest = max(float(segment.get("duration") or 0.0) for segment in segments)
        lines = [
            "#EXTM3U",
            "#EXT-X-VERSION:3",
            f"#EXT-X-TARGETDURATION:{max(1, int(math.ceil(longest)))}",
            "#EXT-X-MEDIA-SEQUENCE:0",
            "#EXT-X-PLAYLIST-TYPE:EVENT",
            "#EXT-X-INDEPENDENT-SEGMENTS",
        ]
        previous: Optional[str] = None
        for segment in segments:
            owner = str(segment.get("recording_id") or "")
            # Kayıtlar arasında zaman damgası sıçrar: oynatıcıya kopukluk bildir.
            if previous is not None and owner != previous:
                lines.append("#EXT-X-DISCONTINUITY")
            previous = owner
            duration = max(0.001, float(segment.get("duration") or 0.0))
            lines.append(f"#EXTINF:{duration:.3f},")
            lines.append(str(segment["file"]))

        _write_atomic(target, lines)
        _write_atomic(vod_target, [*lines, "#EXT-X-ENDLIST"])
    except OSError as exc:
        logger.warning("streams: playlist yazılamadı: %s", exc)


def ensure_playlists(stream_id: str) -> None:
    """Playlist dosyaları yoksa/eskiyse segment listesinden üretir."""
    if not valid_id(stream_id):
        return
    load(stream_id)


def blocks(record: dict[str, Any]) -> list[dict[str, Any]]:
    """Segmentleri kayıt bazında bloklara indirger (zaman çizelgesi blokları)."""
    result: list[dict[str, Any]] = []
    for segment in record["segments"]:
        owner = str(segment.get("recording_id") or "")
        start = float(segment.get("start") or 0.0)
        end = float(segment.get("end") or 0.0)
        if result and result[-1]["recording_id"] == owner:
            last = result[-1]
            last["end"] = end
            last["segments"] += 1
            last["bytes"] += int(segment.get("bytes") or 0)
            continue
        result.append(
            {
                "recording_id": owner,
                "title": segment.get("title") or owner,
                "start": start,
                "end": end,
                "segments": 1,
                "bytes": int(segment.get("bytes") or 0),
                "created_at": float(
                    segment.get("created_at") or record.get("created_at") or 0.0
                ),
            }
        )
    return result


def summary(stream_id: str) -> Optional[dict[str, Any]]:
    """Arayüze dönen akış özeti (yollar ve başlıklar sızdırılmaz)."""
    record = load(stream_id)
    if record is None:
        return None

    probe = record.get("probe") or {}
    return {
        "id": record["id"],
        "project_id": record.get("project_id"),
        "title": record.get("title"),
        "duration": round(float(record.get("duration") or 0.0), 3),
        "segments": len(record["segments"]),
        "bytes": sum(int(segment.get("bytes") or 0) for segment in record["segments"]),
        "size_mb": round(
            sum(int(segment.get("bytes") or 0) for segment in record["segments"])
            / (1024 * 1024),
            2,
        ),
        "created_at": float(record.get("created_at") or 0.0),
        "updated_at": float(record.get("updated_at") or 0.0),
        "width": int(probe.get("width") or 0),
        "height": int(probe.get("height") or 0),
        "fps": float(probe.get("fps") or 0.0),
        "has_audio": bool(probe.get("has_audio")),
        "url": playlist_url(stream_id),
        "revision": len(record["segments"]),
        "playback": int(record.get("playback") or 0),
        "blocks": blocks(record),
    }


# ------------------------------------------------------------------- yazma
async def append(
    stream_id: str,
    *,
    data: bytes,
    duration: float,
    recording_id: str,
    title: Optional[str] = None,
    source_sequence: Optional[int] = None,
    created_at: Optional[float] = None,
) -> Optional[dict[str, Any]]:
    """Yeni segmenti akışın sonuna ekler; playlist'i tazeler.

    Segment dosyası önce diske, sonra deftere yazılır: çökme anında playlist
    yarım segment göstermez (dosya varken dizin kaydı yoktur, bir sonraki
    açılışta segment yeniden indirilir).
    """
    if not valid_id(stream_id):
        raise StreamError(t("error.streamNotFound"), 404)

    async with _lock(stream_id):
        record = load(stream_id) or _empty(stream_id, stream_id, title)
        directory = stream_dir(stream_id)
        try:
            directory.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise StreamError(t("error.recordWriteFailed", detail=exc)) from None

        # Silinen kayıtlardan sonra numara çakışmasın: en büyük dosya numarası.
        number = max((_segment_number(segment) for segment in record["segments"]), default=0) + 1
        file_name = f"{SEGMENT_PREFIX}{number:06d}{SEGMENT_EXTENSION}"
        target = directory / file_name
        try:
            target.write_bytes(data)
        except OSError as exc:
            raise StreamError(t("error.recordWriteFailed", detail=exc)) from None

        segment = {
            "file": file_name,
            "duration": round(max(0.0, float(duration or 0.0)), 3),
            "bytes": len(data),
            "recording_id": recording_id,
            "title": title,
            "source_sequence": source_sequence,
            "created_at": created_at or time.time(),
        }
        record["segments"].append(segment)
        _reindex(record)
        record["updated_at"] = time.time()
        if not record.get("title"):
            record["title"] = title

        if record.get("probe") is None:
            record["probe"] = await _probe(target)

        _save(record)
        _write_playlist(record)
        return summary(stream_id)


async def _probe(path: Path) -> Optional[dict[str, Any]]:
    """İlk segmentten akış meta verisi (çözünürlük, ses) çıkarır."""
    try:
        info = await probe_url(str(path))
    except ProbeError as exc:
        logger.info("streams: segment analiz edilemedi: %s", exc)
        return None
    return {
        "width": int(info.get("width") or 0),
        "height": int(info.get("height") or 0),
        "fps": float(info.get("fps") or 0.0),
        "has_audio": bool(info.get("has_audio")),
    }


async def remove_recording(stream_id: str, recording_id: str) -> Optional[dict[str, Any]]:
    """Bir kaydın segmentlerini akıştan çıkarır (dosyalarıyla birlikte)."""
    if not valid_id(stream_id):
        raise StreamError(t("error.recordingNotFound"), 404)

    async with _lock(stream_id):
        record = load(stream_id)
        if record is None:
            raise StreamError(t("error.recordingNotFound"), 404)

        removed = [
            segment
            for segment in record["segments"]
            if str(segment.get("recording_id")) == recording_id
        ]
        if not removed:
            raise StreamError(t("error.recordingNotFound"), 404)

        record["segments"] = [
            segment
            for segment in record["segments"]
            if str(segment.get("recording_id")) != recording_id
        ]
        for segment in removed:
            try:
                (stream_dir(stream_id) / str(segment["file"])).unlink(missing_ok=True)
            except OSError:
                continue

        _reindex(record)
        record["updated_at"] = time.time()
        # Segment numaraları kaydığı için oynatıcı sıfırdan bağlanmalı.
        record["playback"] = int(record.get("playback") or 0) + 1
        _save(record)
        _write_playlist(record)
        return summary(stream_id)


def clear(stream_id: str) -> None:
    """Akışı tamamen siler (elle temizlik / testler)."""
    record = load(stream_id)
    if record is not None:
        for segment in record["segments"]:
            try:
                (stream_dir(stream_id) / str(segment["file"])).unlink(missing_ok=True)
            except OSError:
                continue
    playlist_path(stream_id).unlink(missing_ok=True)
    index_path(stream_id).unlink(missing_ok=True)
    _RECORDS.pop(stream_id, None)


def forget_cache() -> None:
    """Bellek önbelleğini boşaltır (disk değiştiyse, testler)."""
    _RECORDS.clear()


__all__ = [
    "PLAYLIST_FILE",
    "VOD_PLAYLIST_FILE",
    "StreamError",
    "append",
    "blocks",
    "clear",
    "ensure_playlists",
    "forget_cache",
    "load",
    "playlist_path",
    "playlist_url",
    "remove_recording",
    "segment_path",
    "stream_dir",
    "summary",
    "valid_id",
    "vod_playlist_path",
]
