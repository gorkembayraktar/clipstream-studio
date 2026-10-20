"""Proxy için başlık belirteci (token) kaydı.

Tarayıcı `<video>` etiketine özel HTTP başlığı veremez. Kaynak başlık
gerektiriyorsa oynatma CORS proxy'si üzerinden yapılır; başlıkların URL'ye
yazılmaması için kısa ömürlü, rastgele bir belirteç altında saklanır.

Kayıt yalnızca bellekte tutulur (sunucu yeniden başlayınca temizlenir) ve
süresi dolan kayıtlar otomatik atılır.
"""
import secrets
import time
from typing import Any, Optional

from services.request_headers import sanitize_headers

TTL_SECONDS = 6 * 3600
MAX_ENTRIES = 64

_entries: dict[str, tuple[dict[str, str], float]] = {}


def register_headers(headers: Any) -> Optional[str]:
    """Başlıkları kaydeder; boşsa `None`, değilse proxy belirteci döner."""
    clean = sanitize_headers(headers)
    if not clean:
        return None

    _prune()
    token = secrets.token_urlsafe(12)
    _entries[token] = (clean, time.time())
    return token


def get_headers(token: Optional[str]) -> dict[str, str]:
    """Belirtecin başlıklarını döner (yoksa/süresi dolduysa boş sözlük)."""
    if not token:
        return {}

    entry = _entries.get(token)
    if entry is None:
        return {}

    headers, created = entry
    if time.time() - created > TTL_SECONDS:
        _entries.pop(token, None)
        return {}

    return dict(headers)


def _prune() -> None:
    now = time.time()
    for key, (_, created) in list(_entries.items()):
        if now - created > TTL_SECONDS:
            _entries.pop(key, None)

    while len(_entries) >= MAX_ENTRIES:
        oldest = min(_entries, key=lambda key: _entries[key][1])
        _entries.pop(oldest, None)
