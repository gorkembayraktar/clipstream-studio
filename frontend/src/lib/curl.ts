/** Chrome DevTools "Copy as cURL" metninden bağlantı ve HTTP başlıklarını ayıklar.
 *
 * Amaç: korumalı bir videoyu oynatabilmek için gereken cookie/referer/
 * authorization gibi başlıkları tek yapıştırmayla kullanabilmek. Desteklenen
 * biçim: bash tarzı `curl 'URL' -H 'ad: değer' ...` (satır devamı `\`).
 * Ek olarak curl olmadan satır satır `ad: değer` bloğu da kabul edilir.
 */

export interface ParsedCurl {
  /** Komuttan çıkarılan bağlantı (bulunamazsa boş). */
  url: string
  /** Kaynağa gönderilecek başlıklar (cookie, referer, authorization…). */
  headers: Record<string, string>
  /** Kullanıcıya gösterilebilecek uyarılar. */
  warnings: string[]
}

/** Değer alan (yok sayılan) curl seçenekleri. */
const FLAGS_WITH_VALUE = new Set([
  "-x",
  "--request",
  "-o",
  "--output",
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-urlencode",
  "--json",
  "-u",
  "--user",
  "-m",
  "--max-time",
  "--connect-timeout",
  "-w",
  "--write-out",
  "--proxy",
  "-t",
  "--upload-file",
  "--cacert",
  "--cert",
  "--key",
  "--resolve",
  "--retry",
  "--retry-delay",
  "--limit-rate",
  "--http-version",
  "--interface",
])

/** Taşınmaması gereken isteğe özgü başlıklar (backend de aynı listeyi süzer). */
const BLOCKED_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "expect",
  "range",
])

/** Değer bir URL'ye benziyor mu? (şemasız `example.com/video` dahil) */
function looksLikeUrl(value: string): boolean {
  const text = value.trim()
  if (!text) return false
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return true
  if (/^www\./i.test(text)) return true
  return /^[\w-]+(\.[\w-]+)+(\/|$)/.test(text)
}

/** Kabuk kurallarına göre (tek/çift tırnak, kaçış) metni belirteçlere ayırır. */
function tokenize(text: string): string[] {
  const tokens: string[] = []
  let current = ""
  let quote: "'" | '"' | null = null
  let started = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (quote) {
      if (char === quote) {
        quote = null
        continue
      }
      // Çift tırnak içinde backslash kaçışı geçerlidir.
      if (char === "\\" && quote === '"' && index + 1 < text.length) {
        current += text[index + 1]
        index += 1
        continue
      }
      current += char
      continue
    }

    if (char === "'" || char === '"') {
      quote = char
      started = true
      continue
    }

    if (/\s/.test(char)) {
      if (started) {
        tokens.push(current)
        current = ""
        started = false
      }
      continue
    }

    if (char === "\\" && index + 1 < text.length) {
      current += text[index + 1]
      index += 1
      started = true
      continue
    }

    current += char
    started = true
  }

  if (started) tokens.push(current)
  return tokens
}

function addCookie(headers: Record<string, string>, raw: string): void {
  const value = raw.trim()
  // `-b @dosya` biçimi desteklenmez (yerel çerez dosyası okunmaz).
  if (!value || value.startsWith("@")) return

  const existing = Object.keys(headers).find((key) => key.toLowerCase() === "cookie")
  if (existing) headers[existing] = `${headers[existing]}; ${value}`
  else headers.Cookie = value
}

function addHeader(headers: Record<string, string>, raw: string): void {
  const colon = raw.indexOf(":")
  if (colon <= 0) return

  const name = raw.slice(0, colon).trim()
  const value = raw.slice(colon + 1).trim()
  if (!name || !value) return
  if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) return
  if (BLOCKED_HEADERS.has(name.toLowerCase())) return

  if (name.toLowerCase() === "cookie") {
    addCookie(headers, value)
    return
  }

  // Aynı ad farklı büyük/küçük harfle gelirse son değer geçerli olur.
  const existing = Object.keys(headers).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  )
  if (existing) headers[existing] = value
  else headers[name] = value
}

/** curl komutunu (ya da düz başlık bloğunu) çözümler; boş metinde `null`. */
export function parseCurl(raw: string): ParsedCurl | null {
  const text = raw
    .replace(/\r\n/g, "\n")
    .replace(/\\\n/g, " ")
    .replace(/\^\n/g, " ")
    // Chrome'un Windows "Copy as cURL (cmd)" biçimi: ^"..." kaçışları
    .replace(/\^"/g, '"')
    .trim()
  if (!text) return null

  const headers: Record<string, string> = {}
  const warnings: string[] = []
  let url = ""

  const tokens = tokenize(text)
  const isCurl = /^curl(\.exe)?$/i.test(tokens[0] ?? "")

  // curl yoksa: satır satır "ad: değer" bloğu (değerdeki boşluklar korunur).
  if (!isCurl) {
    for (const line of text.split("\n").map((item) => item.trim()).filter(Boolean)) {
      if (!url && looksLikeUrl(line)) {
        url = line
        continue
      }
      if (line.includes(":")) addHeader(headers, line)
    }
    if (!url && Object.keys(headers).length === 0) return null
    return { url, headers, warnings }
  }

  const takeValue = (index: number): [string, number] => [
    tokens[index + 1] ?? "",
    index + 1,
  ]

  let index = 1
  while (index < tokens.length) {
    const token = tokens[index]
    const lower = token.toLowerCase()

    if (lower === "-h" || lower === "--header") {
      const [value, next] = takeValue(index)
      addHeader(headers, value)
      index = next + 1
      continue
    }

    if (lower === "-b" || lower === "--cookie") {
      const [value, next] = takeValue(index)
      addCookie(headers, value)
      index = next + 1
      continue
    }

    if (lower === "-a" || lower === "--user-agent") {
      const [value, next] = takeValue(index)
      addHeader(headers, `User-Agent: ${value}`)
      index = next + 1
      continue
    }

    if (lower === "-e" || lower === "--referer") {
      const [value, next] = takeValue(index)
      addHeader(headers, `Referer: ${value}`)
      index = next + 1
      continue
    }

    if (lower === "--url") {
      const [value, next] = takeValue(index)
      if (!url) url = value
      index = next + 1
      continue
    }

    if (FLAGS_WITH_VALUE.has(lower)) {
      if (["-d", "--data", "--data-raw", "--data-binary", "--data-urlencode", "--json"].includes(lower)) {
        warnings.push("Gönderi verisi (--data) yok sayıldı.")
      }
      const [, next] = takeValue(index)
      index = next + 1
      continue
    }

    if (token.startsWith("-")) {
      // -L, --compressed, -s, -k, --insecure…: kaynağı etkilemez.
      index += 1
      continue
    }

    if (!url && looksLikeUrl(token)) url = token
    index += 1
  }

  return { url, headers, warnings }
}
