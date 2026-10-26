#!/usr/bin/env python3
"""`docs/project-map.md` dosyasını üretir.

Amaç: ajanın (ve insanın) aradığı dosyayı tek aramada bulması. Harita her
modülün ilk docstring satırını ve her TypeScript dosyasının dışa aktardığı
sembolleri listeler; böylece "nerede?" sorusu grep tahminine dönüşmez.

Kullanım:
    python scripts/project-map.py           # haritayı yeniden yaz
    python scripts/project-map.py --check    # güncel değilse 1 ile çık
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "project-map.md"

SKIP_DIRS = {
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    "node_modules",
    "dist",
    "build",
    "cache",
    "exports",
    ".opencode",
}

TS_EXPORT_RE = re.compile(
    r"^export\s+(?:default\s+)?(?:async\s+)?(?:function|const|enum|class)\s+([A-Za-z_$][\w$]*)",
    re.MULTILINE,
)
MAX_EXPORTS = 8


def first_line(text: str | None) -> str:
    if not text:
        return ""
    for raw in text.strip().splitlines():
        line = raw.strip()
        if line:
            return line
    return ""


def python_summary(path: Path) -> str:
    """Modül docstring'inin ilk satırı; yoksa boş."""
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (OSError, SyntaxError, UnicodeDecodeError):
        return ""
    doc = ast.get_docstring(tree) or ""
    return first_line(doc)


def ts_exports(path: Path) -> list[str]:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return []
    seen: list[str] = []
    for name in TS_EXPORT_RE.findall(text):
        if name not in seen:
            seen.append(name)
    return seen[:MAX_EXPORTS]


def walk(base: Path, suffixes: tuple[str, ...]):
    for path in sorted(base.rglob("*")):
        if not path.is_file() or path.suffix not in suffixes:
            continue
        if any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts):
            continue
        yield path


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def table(rows: list[tuple[str, str]], head: str) -> list[str]:
    if not rows:
        return []
    cells = [(f"`{name}`", summary or "—") for name, summary in rows]
    width = max(len(cell) for cell, _ in cells + [(head, "")])
    lines = [f"| {head.ljust(width)} | Açıklama / semboller |", f"|{'-' * (width + 2)}|------------------------|"]
    for cell, summary in cells:
        lines.append(f"| {cell.ljust(width)} | {summary} |")
    return lines


def backend_section() -> list[str]:
    groups: dict[str, list[tuple[str, str]]] = {}
    for path in walk(ROOT / "backend", (".py",)):
        parts = path.relative_to(ROOT / "backend").parts
        group = parts[0] if len(parts) > 1 else "kök"
        groups.setdefault(group, []).append((path.name, python_summary(path)))

    lines = ["## Backend (`backend/`)"]
    titles = {
        "kök": "Giriş noktası ve yapılandırma",
        "api": "HTTP uçları (`backend/api/`)",
        "core": "Çekirdek yardımcılar (`backend/core/`)",
        "services": "Servisler (`backend/services/`) — asıl iş mantığı",
        "tests": "Testler (`backend/tests/`)",
    }
    for group in ["kök", "api", "core", "services", "tests"]:
        if group not in groups:
            continue
        lines.append("")
        lines.append(f"### {titles.get(group, group)}")
        lines.append("")
        lines.extend(table(groups[group], "Dosya"))
    return lines


def frontend_section() -> list[str]:
    groups: dict[str, list[tuple[str, str]]] = {}
    base = ROOT / "frontend" / "src"
    for path in walk(base, (".ts", ".tsx")):
        parts = path.relative_to(base).parts
        if parts[0] == "components" and len(parts) > 2:
            group = f"components/{parts[1]}"
        else:
            group = parts[0] if len(parts) > 1 else "kök"
        exports = ", ".join(ts_exports(path)) or "—"
        groups.setdefault(group, []).append((path.name, exports))

    titles = {
        "components/app": "Uygulama bileşenleri (`components/app/`)",
        "components/ui": "UI temelleri (`components/ui/`)",
        "hooks": "Hook'lar (`hooks/`)",
        "lib": "Yardımcılar (`lib/`)",
        "stores": "Zustand store'ları (`stores/`)",
        "i18n": "Çeviriler (`i18n/`)",
        "assets": "Varlıklar (`assets/`)",
        "kök": "Giriş dosyaları",
    }
    order = ["kök", "components/app", "components/ui", "hooks", "lib", "stores", "i18n", "assets"]
    lines = ["## Frontend (`frontend/src/`)"]
    for group in order:
        if group not in groups:
            continue
        lines.append("")
        lines.append(f"### {titles.get(group, group)}")
        lines.append("")
        lines.extend(table(groups[group], "Dosya"))
    return lines


def build() -> str:
    lines = [
        "# Project map",
        "",
        "> `python scripts/project-map.py` ile üretilir; elle düzenlemeyin.",
        "> Amacı: dosya adı bilinmeyen bir konuyu tek aramada bulmak.",
        "",
        "## Nasıl kullanılır",
        "",
        "1. Konuyu bu dosyada ara (ör. `dalga`, `waveform`, `export`).",
        "2. Açıklaması uyan dosyayı doğrudan aç; tüm repoyu tarama.",
        "3. Dosya adları dalga formu yerine görev adına göre konur (`waveform-layer`, `export-advanced-settings`).",
        "",
    ]
    lines.extend(backend_section())
    lines.append("")
    lines.extend(frontend_section())
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    content = build()
    normalized = content.replace("\r\n", "\n")
    if "--check" in sys.argv[1:]:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current.replace("\r\n", "\n") != normalized:
            print("project-map.md güncel değil: python scripts/project-map.py", file=sys.stderr)
            return 1
        print("project-map.md güncel")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(normalized, encoding="utf-8", newline="\n")
    print(f"yazıldı: {rel(OUT)} ({len(normalized.splitlines())} satır)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
