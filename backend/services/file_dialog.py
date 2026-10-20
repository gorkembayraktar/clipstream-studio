"""Windows'ta yerel dosya seçim penceresi (kopyasız kaynak).

Tarayıcı, dosya seçicide seçilen dosyanın **gerçek yolunu** vermez (güvenlik).
Kopyasız çalışabilmek için pencereyi sunucu açar: tkinter ayrı bir Python
sürecinde çalıştırılır (konsol penceresi görünmez), seçilen yol UTF-8 bir
geçici dosyaya yazılır ve oradan okunur.

`cancel_dialog()` açık pencereyi kapatır: süreç sonlandırıldığında pencere de
kaybolur, `choose_video_file` boş dize (iptal) döner.
"""
import os
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

_DIALOG_SCRIPT = r"""
import sys
import traceback
from pathlib import Path

out = Path(sys.argv[1])
timeout_ms = int(sys.argv[2] or 0)

try:
    import tkinter as tk
    from tkinter import filedialog
except Exception:
    traceback.print_exc()
    raise SystemExit(3)

root = None
chosen = ""
try:
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    root.update()
    if timeout_ms > 0:
        # Test/otomatik kapanma: pencere belirtilen süre sonra kendiliğinden kapanır.
        root.after(timeout_ms, root.destroy)
    chosen = filedialog.askopenfilename(
        parent=root,
        title="Video se\u00e7 \u2014 ClipStream Studio",
        filetypes=[
            (
                "Video dosyalar\u0131",
                "*.mp4 *.m4v *.mov *.webm *.mkv *.avi *.ts *.mts *.m2ts "
                "*.flv *.wmv *.3gp *.ogv *.mpg *.mpeg",
            ),
            ("T\u00fcm dosyalar", "*.*"),
        ],
    )
except Exception:
    traceback.print_exc()
    chosen = ""
    raise SystemExit(4)
finally:
    try:
        out.write_text(chosen or "", encoding="utf-8")
    except Exception:
        pass
    try:
        if root is not None:
            root.destroy()
    except Exception:
        pass
"""

#: Aynı anda yalnızca bir pencere açılır (çift tıklama koruması).
_dialog_lock = threading.Lock()
#: Açık pencere süreci (iptal için) ve iptal bayrağı.
_active_process: "subprocess.Popen[str] | None" = None
#: Pencere henüz açılmamışken gelen iptalleri yakalamak için.
_pending_pick = False
_cancel_requested = False


class DialogUnavailable(Exception):
    """Dosya seçim penceresi açılamadı (platform/tkinter eksik vb.)."""


def cancel_dialog() -> bool:
    """Açık dosya seçim penceresini kapatır; bekleyen işlem yoksa False döner."""
    global _cancel_requested

    process = _active_process
    if process is None and not _pending_pick:
        return False

    # Pencere henüz açılmadıysa bayrak, açılış anında yakalanır.
    _cancel_requested = True
    if process is None or process.poll() is not None:
        return True

    try:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
    except Exception:
        return False
    return True


def choose_video_file(timeout_ms: int = 0) -> str:
    """Kullanıcıya dosya seçtirir; seçilen tam yolu döner (iptalde boş dize)."""
    global _active_process, _pending_pick, _cancel_requested

    if sys.platform != "win32":
        raise DialogUnavailable(
            "Yerel dosya seçim penceresi yalnızca Windows'ta kullanılabilir."
        )

    if not _dialog_lock.acquire(blocking=False):
        raise DialogUnavailable("Zaten açık bir dosya seçim penceresi var.")

    _pending_pick = True
    handle, name = tempfile.mkstemp(prefix="clip2-pick-", suffix=".txt")
    os.close(handle)
    result_path = Path(name)
    _cancel_requested = False

    try:
        # İptal, pencere açılmadan önce geldiyse hiç açma.
        if _cancel_requested:
            return ""

        process = subprocess.Popen(
            [
                sys.executable,
                "-c",
                _DIALOG_SCRIPT,
                str(result_path),
                str(max(0, int(timeout_ms or 0))),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        _active_process = process

        try:
            _, stderr = process.communicate()
        except Exception:
            try:
                process.kill()
            except Exception:
                pass
            raise

        try:
            chosen = result_path.read_text(encoding="utf-8").strip()
        except OSError:
            chosen = ""

        if _cancel_requested:
            return ""

        if process.returncode != 0 and not chosen:
            lines = [line for line in (stderr or "").strip().splitlines() if line]
            reason = lines[-1] if lines else f"çıkış kodu {process.returncode}"
            raise DialogUnavailable(f"Dosya seçim penceresi açılamadı: {reason}")

        return chosen
    except OSError as exc:
        raise DialogUnavailable(f"Dosya seçim penceresi açılamadı: {exc}") from None
    finally:
        _active_process = None
        _pending_pick = False
        _cancel_requested = False
        _dialog_lock.release()
        try:
            result_path.unlink(missing_ok=True)
        except OSError:
            pass
