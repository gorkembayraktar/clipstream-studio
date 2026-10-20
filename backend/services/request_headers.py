"""Kullanıcı tanımlı HTTP başlıkları (curl yapıştırma).

Kullanıcı, korumalı bir videoyu oynatabilmek için tarayıcıdan kopyaladığı
`curl` komutunu yapıştırabilir. Buradaki başlıklar (cookie, referer,
authorization…) hem FFmpeg/ffprobe girişlerine hem de CORS proxy'sine
uygulanır.

Güvenlik: yalnızca kaynağa taşınması anlamlı başlıklar kabul edilir; istek
gövdesine ait başlıklar (`host`, `content-length`, `range`…) atılır ve
değerlerdeki satır sonları temizlenir (başlık enjeksiyonunu engeller).
"""
import hashlib
import re
from typing import Any, Mapping, Optional

#: İsteğe özgü olan / kaynağa taşınmaması gereken başlıklar.
_BLOCKED = {
    "host",
    "content-length",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "te",
    "trailer",
    "upgrade",
    "expect",
    "proxy-authorization",
    "proxy-authenticate",
    # Aralık istekleri tarayıcıdan gelir; kaynak başlığı olarak taşınamaz.
    "range",
}

_NAME_RE = re.compile(r"^[A-Za-z0-9!#$%&'*+.^_`|~-]+$")
MAX_HEADERS = 40
MAX_VALUE_LENGTH = 8192


def sanitize_headers(value: Any) -> dict[str, str]:
    """Kullanıcıdan gelen başlıkları güvenli ve tekilleştirilmiş sözlüğe çevirir."""
    if not isinstance(value, Mapping):
        return {}

    result: dict[str, str] = {}
    seen: set[str] = set()
    for raw_name, raw_value in value.items():
        name = str(raw_name).strip()
        lowered = name.lower()
        if not name or not _NAME_RE.match(name) or lowered in _BLOCKED or lowered in seen:
            continue

        text = str(raw_value).replace("\r", " ").replace("\n", " ").strip()
        if not text:
            continue

        result[name] = text[:MAX_VALUE_LENGTH]
        seen.add(lowered)
        if len(result) >= MAX_HEADERS:
            break

    return result


def find_header(headers: Mapping[str, str], name: str) -> Optional[str]:
    """Başlığı büyük/küçük harf duyarsız arar."""
    wanted = name.lower()
    for key, value in headers.items():
        if key.lower() == wanted:
            return value
    return None


def _pop_header(headers: dict[str, str], name: str) -> Optional[str]:
    wanted = name.lower()
    for key in list(headers):
        if key.lower() == wanted:
            return headers.pop(key)
    return None


def ffmpeg_input_args(headers: Any, default_user_agent: Optional[str] = None) -> list[str]:
    """FFmpeg/ffprobe giriş seçenekleri (`-i` işaretinden ÖNCE eklenmeli).

    - `User-Agent` → `-user_agent`
    - `Cookie` → `-cookies` (FFmpeg'in önerdiği yol)
    - Diğerleri → tek bir `-headers` bloğu (her satır CRLF ile biter)
    """
    clean = sanitize_headers(headers)
    cookie = _pop_header(clean, "cookie")
    user_agent = _pop_header(clean, "user-agent") or default_user_agent

    args: list[str] = []
    if user_agent:
        args += ["-user_agent", user_agent]
    if cookie:
        args += ["-cookies", cookie]
    if clean:
        header_text = "".join(f"{name}: {value}\r\n" for name, value in clean.items())
        args += ["-headers", header_text]
    return args


def header_fingerprint(headers: Any) -> str:
    """Önbellek anahtarına eklenecek kısa başlık parmak izi.

    Aynı URL farklı cookie/başlıklarla farklı içerik döndürebilir; dalga formu
    ve kare önbelleklerinin karışmaması için kullanılır.
    """
    clean = sanitize_headers(headers)
    if not clean:
        return ""
    raw = "\n".join(f"{key.lower()}:{value}" for key, value in sorted(clean.items()))
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:10]
