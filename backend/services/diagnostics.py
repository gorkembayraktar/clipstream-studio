"""Bellek kullanımı ve sınırlı önbelleklerin anlık görüntüsü.

`GET /api/diagnostics/memory` bu modülü kullanır. Amaç, "uygulama uzun
oturumda neden şişiyor?" sorusunu tahminle değil sayıyla yanıtlamak: süreç
RSS'i, Python ayırıcısının blok sayısı, GC sayaçları ve her önbelleğin kaç
kayıt tuttuğu.

Modül, önbellekleri tek tek sarmalamak yerine servis modüllerinin kendi
durumlarını okur: sayımlar yalnızca burada gerekiyor ve her servise ayrı bir
`cache_stats()` eklemek arayüzü şişirirdi.
"""
import gc
import sys
from typing import Any, Optional


def _rss_bytes() -> Optional[int]:
    """Süreç çalışma kümesini bayt cinsinden verir (desteklenmiyorsa None)."""
    if sys.platform == "win32":
        try:
            import ctypes
            from ctypes import wintypes

            class _ProcessMemoryCounters(ctypes.Structure):
                _fields_ = [
                    ("cb", wintypes.DWORD),
                    ("PageFaultCount", wintypes.DWORD),
                    ("PeakWorkingSetSize", ctypes.c_size_t),
                    ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t),
                    ("PeakPagefileUsage", ctypes.c_size_t),
                ]

            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.GetCurrentProcess.restype = wintypes.HANDLE
            # 64 bit süreç tutamacı `argtypes` verilmezse 32 bite kırpılır ve
            # çağrı sessizce başarısız olur; bu yüzden imzalar açıkça yazılır.
            read_memory = getattr(kernel32, "K32GetProcessMemoryInfo", None)
            if read_memory is None:
                psapi = ctypes.WinDLL("psapi", use_last_error=True)
                read_memory = psapi.GetProcessMemoryInfo
            read_memory.argtypes = [
                wintypes.HANDLE,
                ctypes.POINTER(_ProcessMemoryCounters),
                wintypes.DWORD,
            ]
            read_memory.restype = wintypes.BOOL

            counters = _ProcessMemoryCounters()
            counters.cb = ctypes.sizeof(counters)
            handle = kernel32.GetCurrentProcess()
            if not read_memory(handle, ctypes.byref(counters), counters.cb):
                return None
            return int(counters.WorkingSetSize)
        except Exception:
            return None

    try:
        import resource

        usage = resource.getrusage(resource.RUSAGE_SELF)
        # Linux ru_maxrss'i KB, macOS bayt cinsinden verir.
        scale = 1024 if sys.platform.startswith("linux") else 1
        return int(usage.ru_maxrss) * scale
    except Exception:
        return None


def _allocated_blocks() -> Optional[int]:
    """Python ayırıcısının tuttuğu blok sayısı (sızıntı için iyi bir sinyal)."""
    try:
        return sys.getallocatedblocks()
    except Exception:
        return None


def _gc_stats() -> dict[str, Any]:
    return {
        "enabled": gc.isenabled(),
        "counts": list(gc.get_count()),
        "threshold": list(gc.get_threshold()),
        "tracked_objects": len(gc.get_objects()),
        "garbage": len(gc.garbage),
        "generations": gc.get_stats(),
    }


def _caches() -> dict[str, Any]:
    from services import exporter, frames, header_store, library
    from services import local_media, streams, thumbnails, waveform

    return {
        "frames": {
            "entries": len(frames._cache),
            "bytes": frames._cache_bytes,
            "limit_entries": frames.MAX_CACHE_ENTRIES,
            "limit_bytes": frames.MAX_CACHE_BYTES,
        },
        "local_files": {
            "entries": len(local_media._FILE_REGISTRY),
            "limit": local_media._FILE_REGISTRY_LIMIT,
        },
        "thumbnail_locks": {
            "entries": len(thumbnails._LOCKS),
            "limit": thumbnails._LOCKS_LIMIT,
        },
        "audio_without_cover": {
            "entries": len(thumbnails._AUDIO_WITHOUT_COVER),
            "limit": thumbnails._AUDIO_WITHOUT_COVER_LIMIT,
        },
        "header_tokens": {
            "entries": len(header_store._entries),
            "limit": header_store.MAX_ENTRIES,
        },
        "streams": {
            "records": len(streams._RECORDS),
            "locks": len(streams._LOCKS),
        },
        "library_meta": {"entries": len(library._META_CACHE)},
        "waveform_locks": {
            "entries": len(waveform._extract_locks),
            "limit": waveform._EXTRACT_LOCKS_LIMIT,
        },
        "export_paths": {
            "reserved": len(exporter._RESERVED_PATHS),
            "copy_probes": len(exporter._COPY_PROBE_CACHE),
        },
    }


def snapshot(*, collect: bool = False) -> dict[str, Any]:
    """Süreç, GC ve önbellek sayımlarını tek bir sözlükte toplar.

    ``collect`` yalnızca teşhis içindir: istek üzerine bir kez çöp toplayıp
    ne kadarının erişilemez olduğunu ve RSS'in değişip değişmediğini
    bildirir. Süreli `gc.collect()` bilinçli olarak yok; GC'nin üretimsel
    maliyetini artırır.
    """
    rss_before = _rss_bytes()
    data: dict[str, Any] = {
        "process": {
            "rss_bytes": rss_before,
            "allocated_blocks": _allocated_blocks(),
            "python": sys.version.split()[0],
        },
        "gc": _gc_stats(),
        "caches": _caches(),
    }
    if collect:
        unreachable = gc.collect()
        # RSS işletim sistemine hemen geri verilmez; iki değeri de bildirip
        # yorumu okuyucuya bırakıyoruz.
        data["collect"] = {
            "unreachable": unreachable,
            "rss_before_bytes": rss_before,
            "rss_after_bytes": _rss_bytes(),
        }
    return data
