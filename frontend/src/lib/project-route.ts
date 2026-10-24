/** URL hash'indeki proje rotası ve uygulama sürümü.
 *
 * Kanonik adres: `http://127.0.0.1:8765/#project/?v=<sürüm>`
 * Hash sunucuya gönderilmez; proje rotası istemci tarafında korunur.
 */
import { APP_VERSION } from "@/lib/app-version"

const ROUTE_PREFIX = "project/"
const HASH_PREFIX = `#${ROUTE_PREFIX}`

/** `#project/?v=...` biçimindeki kanonik hash'i üretir. */
export function projectHash(version: string = APP_VERSION): string {
  return `${HASH_PREFIX}?v=${encodeURIComponent(version)}`
}

/** Adres çubuğunu güncel uygulama sürümüyle kanonik proje rotasına getirir. */
export function ensureProjectHash(): void {
  if (typeof window === "undefined") return
  const target = projectHash()
  if (window.location.hash === target) return

  const url = new URL(window.location.href)
  url.hash = target
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  )
}

/** Yeni proje yüklemesi bittikten sonra dönülecek temiz adres. */
export function cleanProjectUrl(): string {
  const url = new URL(window.location.href)
  url.search = ""
  url.hash = projectHash()
  return url.toString()
}
