/** URL hash'indeki proje rotası ve uygulama sürümü.
 *
 * Kanonik adres: `http://127.0.0.1:8765/#project/?id=<id>&v=<sürüm>`
 * Hash sunucuya gönderilmez; proje rotası istemci tarafında korunur.
 */
import { APP_VERSION } from "@/lib/app-version"

const ROUTE_PREFIX = "project/"
const HASH_PREFIX = `#${ROUTE_PREFIX}`

/** Proje kimlikleri URL'de ve localStorage anahtarında güvenle kullanılabilir. */
const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/

/** `#project/?...` hash'ini sorgu parametrelerine ayırır. */
function hashParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams()
  const hash = window.location.hash
  if (!hash.startsWith(HASH_PREFIX)) return new URLSearchParams()

  const rest = hash.slice(HASH_PREFIX.length)
  const queryIndex = rest.indexOf("?")
  return new URLSearchParams(queryIndex >= 0 ? rest.slice(queryIndex + 1) : "")
}

/** URL'deki ham proje kimliğini döndürür (geçersiz olabilir).
 *
 * Eski `project=<id>` bağlantıları da okunur; adres çubuğu açılışta `id`
 * biçimine taşınır.
 */
export function projectParamFromUrl(): string | null {
  const params = hashParams()
  const value = params.get("id") ?? params.get("project")
  return value && value.trim() ? value : null
}

/** Proje kimliği geçerli biçimde mi? */
export function isProjectId(value: string | null | undefined): value is string {
  return typeof value === "string" && PROJECT_ID_PATTERN.test(value)
}

/** URL'deki geçerli proje kimliğini döndürür; yoksa/bozuksa null. */
export function readProjectIdFromUrl(): string | null {
  const value = projectParamFromUrl()
  return isProjectId(value) ? value : null
}

/** `#project/?id=...&v=...` biçimindeki kanonik hash'i üretir. */
export function projectHash(
  projectId?: string | null,
  version: string = APP_VERSION,
): string {
  const params = new URLSearchParams()
  if (projectId) params.set("id", projectId)
  params.set("v", version)
  return `${HASH_PREFIX}?${params.toString()}`
}

function replaceHash(hash: string): void {
  if (typeof window === "undefined") return
  const url = new URL(window.location.href)
  url.hash = hash
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  )
}

/** Adres çubuğunu güncel sürümle kanonik proje rotasına getirir.
 *
 * Mevcut proje parametresi (`id`, eski bağlantılarda `project`) korunur;
 * geçersizse temizlenir.
 */
export function ensureProjectHash(): void {
  if (typeof window === "undefined") return
  const raw = projectParamFromUrl()
  const projectId = isProjectId(raw) ? raw : null
  const target = projectHash(projectId)
  if (window.location.hash === target) return
  replaceHash(target)
}

/** Yeni proje kimliğini adres çubuğuna yeniden yükleme yapmadan yazar. */
export function setProjectInUrl(projectId: string): void {
  replaceHash(projectHash(projectId))
}

/** Proje parametresini adres çubuğundan kaldırır; sürüm parametresi kalır. */
export function clearProjectFromUrl(): void {
  replaceHash(projectHash())
}

/** Projeyi tam sayfa yükleyecek mutlak adresi üretir. */
export function projectUrl(projectId?: string | null): string {
  const url = new URL(window.location.href)
  url.search = ""
  url.hash = projectHash(projectId)
  return url.toString()
}

/** Yeni proje yüklemesi bittikten sonra dönülecek temiz adres. */
export function cleanProjectUrl(): string {
  return projectUrl()
}
