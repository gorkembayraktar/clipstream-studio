/** Medya URL'si yardımcıları. */

/** URL bir HLS (m3u8) kaynağı mı? (proxy ile yüzde kodlanmış URL'ler de tanınır) */
export function isHlsUrl(url: string): boolean {
  let decoded = url
  try {
    decoded = decodeURIComponent(url)
  } catch {
    /* bozuk yüzde kodlaması: ham URL ile devam edilir */
  }
  return /\.m3u8(\?|#|$)/i.test(decoded) || decoded.includes("manifest.googlevideo.com")
}

/** Verilen URL'yi backend CORS proxy'si üzerinden oynatılacak hale getirir.
 *
 * `headerToken`: curl ile yapıştırılan başlıkların sunucudaki belirteci;
 * başlık gerektiren kaynaklarda proxy isteğine eklenir (HLS segmentleri dahil).
 */
export function proxiedUrl(url: string, headerToken?: string | null): string {
  const base = `/api/media/proxy?url=${encodeURIComponent(url)}`
  return headerToken ? `${base}&t=${encodeURIComponent(headerToken)}` : base
}

/** Şemasız yapıştırılan bağlantıları (ör. `x.com/...`) https:// ile tamamlar. */
export function withScheme(value: string): string {
  const text = value.trim()
  if (!text || /^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text
  return `https://${text.replace(/^\/+/, "")}`
}

/**
 * Panodan gelen metinden yapıştırılacak bağlantıyı ayıklar.
 *
 * Tek satırlık kopyalamalarda metnin kendisi kullanılır; çok satırlı
 * kopyalamalarda (ör. YouTube'un "başlık + link" paylaşımı) önce satır içinde
 * geçen http(s) bağlantısı, yoksa bağlantıya benzeyen ilk satır aranır.
 */
export function extractPastedUrl(raw: string): string {
  const text = raw.trim()
  if (!text) return ""

  const inline = text.match(/https?:\/\/[^\s<>"']+/i)
  if (inline) return inline[0].replace(/[),.;\]}]+$/, "")

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const urlLike = lines.find(
    (line) => /^(www\.)/i.test(line) || /^[\w-]+(\.[\w-]+)+\//.test(line),
  )
  return urlLike ?? lines[0] ?? ""
}
