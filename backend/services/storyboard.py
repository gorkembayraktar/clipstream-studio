"""Zaman çizelgesi storyboard'u: kaynak başına kademeli JPEG döşemeleri + JSON.

Tasarım notları:
- Toplam kare sayısı 100 ile sınırlıdır; aralık en az 2 sn'dir. Uzun
  kaynaklarda aralık büyür, böylece toplam veri hacmi sınırlı kalır.
- Kareler 10'luk gruplar halinde üretilir. İlk grup tüm süreye eşit dağıtılır;
  sonraki gruplar kalan en büyük boşlukları doldurur. İlk önizleme hızla
  hazır olur, ayrıntı arka planda artar.
- Her grup ayrı bir JPEG sprite olarak önbelleğe alınır. İstemci yüklenen
  grupların en yakın karesini CSS ile yerel olarak kırpar.
- Yerel ve uzak kaynaklarda yalnızca seçilen zamanlar `-ss` ile çıkarılır;
  tüm akış çözülmez. HLS master playlist varsa en hafif varyant seçilir.
- Sonuç `cache/storyboard/<özet>.jpg` ve `.json` olarak saklanır; sprite
  değişmez anahtarlı olduğu için uzun ömürlü HTTP önbelleğiyle servis edilir.
"""
import asyncio
import hashlib
import json
import logging
import math
import re
import shutil
import time
from pathlib import Path
from typing import Any, Optional

from config import STORYBOARD_CACHE_DIR, STORYBOARD_TEMP_DIR, USER_AGENT
from core.i18n import t
from services.hls import is_master_playlist, parse_playlist_variants, pick_lightest_variant
from services.local_media import local_path
from services.request_headers import ffmpeg_input_args, header_fingerprint
from services.segment_downloader import (
    download_hls_segments,
    load_hls_playlist,
    locate_segment,
)

WIDTH = 160
HEIGHT = 90
BATCH_SIZE = 10
MAX_TILES = 100
MIN_INTERVAL_SECONDS = 2.0
QUALITY = 5
CACHE_VERSION = 2
CACHE_TTL_DAYS = 30
MAX_CACHE_SHEETS = 500
FRAME_TIMEOUT_SECONDS = 45.0
SPARSE_TIMEOUT_SECONDS = 300.0
EXTRACT_CONCURRENCY = 3
#: HLS segmentleri ağdan paralel indirilir; yerel FFmpeg çıkarımı ayrıca
#: EXTRACT_CONCURRENCY ile sınırlanır.
HLS_SEGMENT_CONCURRENCY = 6
HLS_SEGMENT_TIMEOUT_SECONDS = 60.0

_KEY_RE = re.compile(r"^[a-f0-9]{40}$")
_logger = logging.getLogger(__name__)
_extract_lock = asyncio.Lock()


class StoryboardError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def plan_storyboard(duration: float) -> dict[str, Any]:
    """Süreye göre toplam kare sayısını ve aralığı hesaplar."""
    try:
        duration = float(duration)
    except (TypeError, ValueError):
        duration = 0.0
    if not math.isfinite(duration) or duration <= 0:
        raise StoryboardError(t("error.storyboardDuration"))

    interval = max(MIN_INTERVAL_SECONDS, duration / MAX_TILES)
    count = max(1, min(MAX_TILES, int(math.ceil(duration / interval))))
    return {
        "duration": round(duration, 3),
        "interval": round(interval, 6),
        "count": count,
        "batch_size": BATCH_SIZE,
        "total_batches": int(math.ceil(count / BATCH_SIZE)),
        "tile_width": WIDTH,
        "tile_height": HEIGHT,
    }


def sample_time(index: int, plan: dict[str, Any]) -> float:
    """Kare indeksinin kaynaktaki zamanı (sn)."""
    return min(
        max(0.0, float(plan["duration"]) - 0.001),
        max(0.0, index * float(plan["interval"])),
    )


def _ordered_indices(count: int) -> list[int]:
    """Tüm kare indekslerini kademeli üretim sırasına dizer.

    İlk 10 indeks süreye eşit dağıtılır. Sonraki her indeks, seçilmiş
    noktalara en uzak kalan boşluğun ortasından seçilir.
    """
    if count <= 0:
        return []

    first_count = min(BATCH_SIZE, count)
    if first_count == 1:
        first = [0]
    else:
        first = []
        for step in range(first_count):
            index = int(round(step * (count - 1) / (first_count - 1)))
            if not first or first[-1] != index:
                first.append(index)

    ordered = list(first)
    selected = set(first)
    while len(ordered) < count:
        best_index = -1
        best_distance = -1
        for index in range(count):
            if index in selected:
                continue
            distance = min(abs(index - other) for other in selected)
            if distance > best_distance:
                best_distance = distance
                best_index = index
        selected.add(best_index)
        ordered.append(best_index)

    return ordered


def batch_indices(count: int, batch: int) -> list[int]:
    """İstenen grubun kare indekslerini döner."""
    total = int(math.ceil(count / BATCH_SIZE)) if count > 0 else 0
    if batch < 0 or batch >= total:
        raise StoryboardError(t("error.storyboardBatch"))
    ordered = _ordered_indices(count)
    start = batch * BATCH_SIZE
    return ordered[start : start + BATCH_SIZE]


def sheet_layout(count: int) -> tuple[int, int]:
    """Bir grubun sprite ızgara düzenini döner."""
    columns = max(1, min(BATCH_SIZE, count))
    rows = max(1, int(math.ceil(count / columns)))
    return columns, rows


def _cache_key(
    source: str,
    origin: Optional[str],
    identity: Optional[str],
    plan: dict[str, Any],
    headers: Any = None,
) -> str:
    stable_source = identity or origin or source
    raw = "|".join(
        [
            str(CACHE_VERSION),
            header_fingerprint(headers),
            stable_source,
            f"{float(plan['duration']):.3f}",
            f"{float(plan['interval']):.6f}",
            f"{int(plan['tile_width'])}x{int(plan['tile_height'])}",
            str(int(plan["count"])),
            str(int(plan["batch_size"])),
        ]
    )
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _batch_cache_key(base_key: str, batch: int, indices: list[int]) -> str:
    raw = f"{base_key}|{batch}|{','.join(str(index) for index in indices)}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def sheet_url(key: str) -> str:
    return f"/api/storyboard/{key}.jpg"


def sheet_path(key: str) -> Optional[Path]:
    """Geçerli anahtar için mevcut sprite dosyasını döner."""
    if not _KEY_RE.match(key or ""):
        return None
    path = STORYBOARD_CACHE_DIR / f"{key}.jpg"
    return path if path.is_file() else None


async def build_storyboard(
    url: str,
    duration: float,
    batch: int = 0,
    origin: Optional[str] = None,
    client: Any = None,
    headers: Any = None,
    identity: Optional[str] = None,
) -> dict[str, Any]:
    """Tek bir storyboard grubunu hazırlar (önbellek varsa doğrudan döner)."""
    if not url:
        raise StoryboardError(t("error.sourceEmpty"))

    plan = plan_storyboard(duration)
    indices = batch_indices(int(plan["count"]), batch)
    columns, rows = sheet_layout(len(indices))
    complete = batch + 1 >= int(plan["total_batches"])

    # origin/identity varsa anahtar kaynak seçiminden önce bellidir: önbellek
    # isabetinde HLS master playlist'ini yeniden indirmeye gerek yok.
    if identity or origin:
        provisional_base = _cache_key(url, origin, identity, plan, headers)
        provisional_key = _batch_cache_key(provisional_base, batch, indices)
        cached = _read_cache(provisional_key)
        if cached is not None:
            return {**cached, "cached": True}

    source, optimized = await _select_source(client, origin, url, headers)
    base_key = _cache_key(source, origin, identity, plan, headers)
    key = _batch_cache_key(base_key, batch, indices)

    cached = _read_cache(key)
    if cached is not None:
        return {**cached, "cached": True, "optimized": optimized}

    # Aynı anda tek storyboard grubu üretilir; ikinci istek önbelleği yeniden
    # denetler. Böylece FFmpeg süreçleri üst üste yığılmaz.
    async with _extract_lock:
        cached = _read_cache(key)
        if cached is not None:
            return {**cached, "cached": True, "optimized": optimized}

        output = STORYBOARD_CACHE_DIR / f"{key}.jpg"
        try:
            await _generate(
                source,
                plan,
                indices,
                columns,
                rows,
                headers,
                output,
                key,
                client=client,
            )
        except StoryboardError:
            output.unlink(missing_ok=True)
            raise
        except asyncio.CancelledError:
            output.unlink(missing_ok=True)
            raise

        payload = {
            "success": True,
            **plan,
            "batch": batch,
            "batch_count": len(indices),
            "complete": complete,
            "columns": columns,
            "rows": rows,
            "indices": indices,
            "times": [round(sample_time(index, plan), 3) for index in indices],
            "sheet_url": sheet_url(key),
            "source_key": key,
            "created_at": int(time.time()),
            "cached": False,
            "optimized": optimized,
        }
        _write_cache(key, payload)
        return payload


async def _select_source(
    client: Any, origin: Optional[str], url: str, headers: Any = None
) -> tuple[str, bool]:
    """Storyboard için en ucuz video kaynağını seçer."""
    for candidate in (origin, url):
        if not isinstance(candidate, str) or ".m3u8" not in candidate.lower():
            continue
        if client is None:
            continue
        try:
            response = await client.get(candidate, headers=headers or None)
            response.raise_for_status()
            text = response.text
        except Exception:
            continue
        if not is_master_playlist(text):
            continue

        lightest = pick_lightest_variant(parse_playlist_variants(text, str(response.url)))
        if lightest:
            return str(lightest["url"]), True

    return url, False


async def _generate(
    source: str,
    plan: dict[str, Any],
    indices: list[int],
    columns: int,
    rows: int,
    headers: Any,
    output: Path,
    key: str,
    client: Any = None,
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    local = local_path(source)
    resolved = str(local) if local is not None else source

    # Uzak HLS kaynaklarında her kare için ayrı FFmpeg süreci açmak yerine
    # yalnızca gereken segmentleri paralel indirip yerelde çıkar. Bu, özellikle
    # çok segmentli playlist'lerde ilk storyboard süresini belirgin kısaltır.
    if local is None and client is not None:
        generated = await _generate_hls_segments(
            client,
            resolved,
            plan,
            indices,
            columns,
            rows,
            headers,
            output,
            key,
        )
        if generated:
            return

    await _generate_sparse(resolved, plan, indices, columns, rows, headers, output, key)

    if not output.is_file() or output.stat().st_size == 0:
        raise StoryboardError(t("error.storyboardFailed"))


def _video_filter() -> str:
    return (
        f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,"
        f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2"
    )


def _tile_filter(columns: int, rows: int, count: int) -> str:
    return f"tile={columns}x{rows}:nb_frames={count}"


def _tile_command(
    workdir: Path,
    columns: int,
    rows: int,
    count: int,
    output: Path,
) -> list[str]:
    return [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-framerate",
        "1",
        "-start_number",
        "0",
        "-i",
        str(workdir / "frame-%03d.jpg"),
        "-vf",
        _tile_filter(columns, rows, count),
        "-frames:v",
        "1",
        "-q:v",
        str(QUALITY),
        "-y",
        str(output),
    ]


def _extract_command(
    source: str, at: float, headers: Any, output: Path
) -> list[str]:
    command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error"]
    if source.startswith(("http://", "https://")):
        command += ffmpeg_input_args(headers, USER_AGENT)
    command += [
        "-ss",
        f"{at:.3f}",
        "-i",
        source,
        "-frames:v",
        "1",
        "-an",
        "-vf",
        _video_filter(),
        "-q:v",
        str(QUALITY),
        "-y",
        str(output),
    ]
    return command


async def _generate_hls_segments(
    client: Any,
    source: str,
    plan: dict[str, Any],
    indices: list[int],
    columns: int,
    rows: int,
    headers: Any,
    output: Path,
    key: str,
) -> bool:
    """HLS segmentlerini bir kez indirip kareleri yerelde çıkarır.

    Başarıda True döner. Playlist uygun değilse (canlı/şifreli/byte-range/
    doğrudan medya) veya indirme/çıkarım başarısızsa False döner; çağıran
    taraf mevcut uzak FFmpeg yoluna geri düşer.
    """
    playlist = await load_hls_playlist(client, source, headers)
    if playlist is None:
        return False

    locations: list[tuple[int, float]] = []
    for index in indices:
        located = locate_segment(playlist, sample_time(index, plan))
        if located is None:
            return False
        locations.append(located)

    downloaded = await download_hls_segments(
        client,
        playlist,
        [segment for segment, _ in locations],
        headers,
        temp_root=STORYBOARD_TEMP_DIR,
        concurrency=HLS_SEGMENT_CONCURRENCY,
        timeout=HLS_SEGMENT_TIMEOUT_SECONDS,
    )
    if downloaded is None:
        return False

    workdir = STORYBOARD_TEMP_DIR / f"{key}-hls-{time.time_ns()}"
    workdir.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(EXTRACT_CONCURRENCY)

    async def extract(order: int, segment: int, offset: float) -> None:
        frame = workdir / f"frame-{order:03d}.jpg"
        async with semaphore:
            await _extract_frame(
                str(downloaded.paths[segment]),
                offset,
                headers,
                frame,
            )

    tasks = [
        asyncio.create_task(extract(order, segment, offset))
        for order, (segment, offset) in enumerate(locations)
    ]
    try:
        try:
            await asyncio.wait_for(
                asyncio.gather(*tasks),
                timeout=SPARSE_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise StoryboardError(
                t("error.storyboardTimeout"), status_code=504
            ) from None
        except BaseException:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise

        await _run(
            _tile_command(workdir, columns, rows, len(indices), output),
            timeout=FRAME_TIMEOUT_SECONDS,
            error_key="error.storyboardFailed",
        )
        return True
    except asyncio.CancelledError:
        raise
    except StoryboardError as exc:
        output.unlink(missing_ok=True)
        if exc.status_code == 504:
            raise
        _logger.info("storyboard HLS hızlı yol başarısız: %s", exc)
        return False
    except Exception as exc:  # noqa: BLE001 - güvenli FFmpeg yoluna dön
        output.unlink(missing_ok=True)
        _logger.info("storyboard HLS hızlı yol başarısız: %s", exc)
        return False
    finally:
        downloaded.cleanup()
        shutil.rmtree(workdir, ignore_errors=True)


async def _generate_sparse(
    source: str,
    plan: dict[str, Any],
    indices: list[int],
    columns: int,
    rows: int,
    headers: Any,
    output: Path,
    key: str,
) -> None:
    workdir = STORYBOARD_TEMP_DIR / f"{key}-{time.time_ns()}"
    workdir.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(EXTRACT_CONCURRENCY)

    async def extract(order: int, index: int) -> None:
        frame = workdir / f"frame-{order:03d}.jpg"
        async with semaphore:
            await _extract_frame(
                source,
                sample_time(index, plan),
                headers,
                frame,
            )

    tasks = [
        asyncio.create_task(extract(order, index))
        for order, index in enumerate(indices)
    ]
    try:
        try:
            await asyncio.wait_for(
                asyncio.gather(*tasks), timeout=SPARSE_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise StoryboardError(t("error.storyboardTimeout"), status_code=504) from None
        except BaseException:
            # Bir kare başarısız olursa diğer FFmpeg süreçleri arka planda kalmasın.
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise

        await _run(
            _tile_command(workdir, columns, rows, len(indices), output),
            timeout=FRAME_TIMEOUT_SECONDS,
            error_key="error.storyboardFailed",
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


async def _extract_frame(
    source: str, at: float, headers: Any, output: Path
) -> None:
    await _run(
        _extract_command(source, at, headers, output),
        timeout=FRAME_TIMEOUT_SECONDS,
        error_key="error.storyboardFailed",
    )


async def _run(command: list[str], timeout: float, error_key: str) -> None:
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        await _kill(process)
        raise StoryboardError(t("error.storyboardTimeout"), status_code=504) from None
    except asyncio.CancelledError:
        await _kill(process)
        raise

    if process.returncode != 0:
        message = stderr.decode("utf-8", errors="ignore").strip()[-300:]
        _logger.warning("storyboard ffmpeg failed: %s", message)
        raise StoryboardError(message or t(error_key))


async def _kill(process: Any) -> None:
    """Süreci sonlandırır ve geri dönüşünü bekler (tanıtıcı/boru sızmasın)."""
    try:
        process.kill()
    except Exception:
        pass
    try:
        await process.wait()
    except Exception:
        pass


def _read_cache(key: str) -> Optional[dict[str, Any]]:
    meta_path = STORYBOARD_CACHE_DIR / f"{key}.json"
    image_path = STORYBOARD_CACHE_DIR / f"{key}.jpg"
    if not meta_path.is_file() or not image_path.is_file():
        return None
    try:
        payload = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def _write_cache(key: str, payload: dict[str, Any]) -> None:
    STORYBOARD_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    meta_path = STORYBOARD_CACHE_DIR / f"{key}.json"
    temp_path = meta_path.with_suffix(".json.tmp")
    temp_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temp_path.replace(meta_path)
    cleanup_storyboards()


def cleanup_storyboards(
    max_age_days: int = CACHE_TTL_DAYS,
    max_sheets: int = MAX_CACHE_SHEETS,
) -> int:
    """Süresi geçen ve fazla storyboard dosyalarını siler."""
    if not STORYBOARD_CACHE_DIR.is_dir():
        return 0

    now = time.time()
    cutoff = now - max_age_days * 86400
    removed = 0
    entries: list[tuple[float, str]] = []
    for meta_path in STORYBOARD_CACHE_DIR.glob("*.json"):
        try:
            mtime = meta_path.stat().st_mtime
        except OSError:
            continue
        key = meta_path.stem
        if mtime < cutoff:
            _remove_pair(key)
            removed += 1
            continue
        entries.append((mtime, key))

    if len(entries) > max_sheets:
        entries.sort()
        for _, key in entries[: len(entries) - max_sheets]:
            _remove_pair(key)
            removed += 1

    # Metadata'sı silinmiş artık JPEG'leri de temizle.
    for image_path in STORYBOARD_CACHE_DIR.glob("*.jpg"):
        meta_path = image_path.with_suffix(".json")
        if not meta_path.is_file():
            try:
                image_path.unlink()
                removed += 1
            except OSError:
                pass

    for temp_dir in STORYBOARD_TEMP_DIR.glob("*"):
        if not temp_dir.is_dir():
            continue
        try:
            age = now - temp_dir.stat().st_mtime
        except OSError:
            continue
        if age > 86400:
            shutil.rmtree(temp_dir, ignore_errors=True)

    return removed


def _remove_pair(key: str) -> None:
    for suffix in (".json", ".jpg"):
        try:
            (STORYBOARD_CACHE_DIR / f"{key}{suffix}").unlink(missing_ok=True)
        except OSError:
            pass
