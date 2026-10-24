"""Windows'ta yerel dosya seÃ§im penceresi (kopyasÄ±z kaynak).

Birincil yÃ¶ntem: PowerShell + .NET Windows.Forms.OpenFileDialog
  - Her zaman en Ã¶nde (topmost) aÃ§Ä±lÄ±r
  - Tkinter/GUI sorunlarÄ±ndan baÄŸÄ±msÄ±z

Yedek yÃ¶ntem: Tkinter (PowerShell baÅŸarÄ±sÄ±z olursa)
"""
import os
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

from core.i18n import t

#: AynÄ± anda yalnÄ±zca bir pencere aÃ§Ä±lÄ±r (Ã§ift tÄ±klama korumasÄ±).
_dialog_lock = threading.Lock()
#: AÃ§Ä±k pencere sÃ¼reci (iptal iÃ§in) ve iptal bayraÄŸÄ±.
_active_process: "subprocess.Popen[str] | None" = None
#: Pencere henÃ¼z aÃ§Ä±lmamÄ±ÅŸken gelen iptalleri yakalamak iÃ§in.
_pending_pick = False
_cancel_requested = False


class DialogUnavailable(Exception):
    """Dosya seÃ§im penceresi aÃ§Ä±lamadÄ± (platform/destek eksik vb.)."""


class DialogAlreadyOpen(Exception):
    """AÃ§Ä±k bir dosya seÃ§im penceresi zaten var."""
    pass


def cancel_dialog() -> bool:
    """AÃ§Ä±k dosya seÃ§im penceresini kapatÄ±r; bekleyen iÅŸlem yoksa False dÃ¶ner."""
    global _cancel_requested

    process = _active_process
    if process is None and not _pending_pick:
        return False

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


_TKINTER_SCRIPT = r"""
import sys
import traceback
from pathlib import Path

out = Path(sys.argv[1])
timeout_ms = int(sys.argv[2] or 0)
title = sys.argv[3] if len(sys.argv) > 3 else "Select video"
video_label = sys.argv[4] if len(sys.argv) > 4 else "Video files"
all_label = sys.argv[5] if len(sys.argv) > 5 else "All files"

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
        root.after(timeout_ms, root.destroy)
    chosen = filedialog.askopenfilename(
        parent=root,
        title=title,
        filetypes=[
            (
                video_label,
                "*.mp4 *.m4v *.mov *.webm *.mkv *.avi *.ts *.mts *.m2ts "
                "*.flv *.wmv *.3gp *.ogv *.mpg *.mpeg",
            ),
            (all_label, "*.*"),
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


def _start_powershell_dialog(title: str) -> "subprocess.Popen[str] | None":
    """PowerShell + topmost form ile OpenFileDialog baÅŸlatÄ±r. Hata olursa None dÃ¶ner."""
    safe_title = title.replace("'", "").replace('"', "")
    ps_script = (
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;"
        "$OutputEncoding = [System.Text.Encoding]::UTF8;"
        "Add-Type -AssemblyName System.Windows.Forms;"
        "$d = New-Object System.Windows.Forms.OpenFileDialog;"
        f"$d.Title = '{safe_title}';"
        "$d.Filter = 'Video files (*.mp4;*.mkv;*.mov;*.webm;*.avi;*.ts;*.m4v;*.mts;*.m2ts;*.flv;*.wmv;*.3gp;*.ogv;*.mpg;*.mpeg)"
        "|*.mp4;*.mkv;*.mov;*.webm;*.avi;*.ts;*.m4v;*.mts;*.m2ts;*.flv;*.wmv;*.3gp;*.ogv;*.mpg;*.mpeg"
        "|All files (*.*)|*.*';"
        "$d.InitialDirectory = [Environment]::GetFolderPath('MyVideos');"
        "$d.RestoreDirectory = $true;"
        "$helper = New-Object System.Windows.Forms.Form;"
        "$helper.TopMost = $true;"
        "$helper.ShowInTaskbar = $false;"
        "$helper.WindowState = 'Minimized';"
        # ShowDialog'Ä±n sahibi gÃ¶rÃ¼nÃ¼r olmalÄ±; Hide() modal pencerenin
        # aÃ§Ä±lmamasÄ±na veya Tkinter yedeÄŸine dÃ¼ÅŸmesine neden oluyordu.
        "$helper.Show();"
        "$r = $d.ShowDialog($helper);"
        "$helper.Close(); $helper.Dispose();"
        "if ($r -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.FileName }"
    )
    try:
        return subprocess.Popen(
            ["powershell", "-NoProfile", "-STA", "-Command", ps_script],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except OSError:
        return None


def choose_video_file(timeout_ms: int = 0) -> str:
    """KullanÄ±cÄ±ya dosya seÃ§tirir; seÃ§ilen tam yolu dÃ¶ner (iptalde boÅŸ dize)."""
    global _active_process, _pending_pick, _cancel_requested

    if sys.platform != "win32":
        raise DialogUnavailable(t("error.pickWindowsOnly"))

    # Ã–nceki istekten askÄ±da kalmÄ±ÅŸ bir sÃ¼reÃ§ varsa kapat
    if _active_process is not None and _active_process.poll() is None:
        cancel_dialog()

    # Kilidi al; Ã¶nceki sÃ¼reÃ§ yeni sonlanÄ±yorsa 1 saniyeye kadar bekle
    if not _dialog_lock.acquire(timeout=1.0):
        if _active_process is not None:
            try:
                _active_process.kill()
            except Exception:
                pass
        if not _dialog_lock.acquire(timeout=0.5):
            raise DialogAlreadyOpen(t("error.pickAlreadyOpen"))

    _pending_pick = True
    _cancel_requested = False

    try:
        if _cancel_requested:
            return ""

        title = t("dialog.title")

        # â”€â”€ Birincil: PowerShell + .NET OpenFileDialog (her zaman topmost) â”€â”€
        proc = _start_powershell_dialog(title)
        if proc is not None:
            _active_process = proc
            try:
                stdout, _ = proc.communicate()
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
                raise
            finally:
                _active_process = None

            if _cancel_requested:
                return ""

            chosen = (stdout or "").strip()
            if chosen:
                return chosen
            if proc.returncode == 0:
                return ""  # KullanÄ±cÄ± iptal etti (normal)
            # Hata â†’ Tkinter fallback'e dÃ¼ÅŸ

        # â”€â”€ Yedek: Tkinter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        handle, name = tempfile.mkstemp(prefix="clip2-pick-", suffix=".txt")
        os.close(handle)
        result_path = Path(name)

        try:
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-c",
                    _TKINTER_SCRIPT,
                    str(result_path),
                    str(max(0, int(timeout_ms or 0))),
                    title,
                    t("dialog.videoFiles"),
                    t("dialog.allFiles"),
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
            finally:
                _active_process = None

            try:
                chosen = result_path.read_text(encoding="utf-8").strip()
            except OSError:
                chosen = ""

            if _cancel_requested:
                return ""

            if process.returncode != 0 and not chosen:
                lines = [line for line in (stderr or "").strip().splitlines() if line]
                reason = lines[-1] if lines else t("error.pickExitCode", code=process.returncode)
                raise DialogUnavailable(t("error.pickOpenFailed", detail=reason))

            return chosen
        except OSError as exc:
            raise DialogUnavailable(t("error.pickOpenFailed", detail=exc)) from None
        finally:
            try:
                result_path.unlink(missing_ok=True)
            except OSError:
                pass

    finally:
        _pending_pick = False
        _cancel_requested = False
        _dialog_lock.release()
