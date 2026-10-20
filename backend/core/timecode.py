"""Zaman dönüşüm yardımcıları."""
from typing import Any


def parse_time_to_seconds(value: Any) -> float:
    """'01:23:45.678', '12:34' veya '42.5' girdilerini saniyeye çevirir."""
    if isinstance(value, (int, float)):
        return float(value)

    text = str(value).strip()
    if not text:
        return 0.0

    if ":" in text:
        try:
            parts = [float(part) for part in text.split(":")]
        except ValueError:
            return 0.0
        if len(parts) == 3:
            return parts[0] * 3600 + parts[1] * 60 + parts[2]
        if len(parts) == 2:
            return parts[0] * 60 + parts[1]
        return 0.0

    try:
        return float(text)
    except ValueError:
        return 0.0


def seconds_to_hms(seconds: float) -> str:
    """Saniyeyi ffmpeg'in kabul ettiği HH:MM:SS.mmm biçimine çevirir."""
    seconds = max(0.0, float(seconds))
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:06.3f}"
