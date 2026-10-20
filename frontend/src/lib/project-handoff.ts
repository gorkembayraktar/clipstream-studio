/** Sürükle-bırakla açılan yeni proje sekmesine dosya sonucunu aktarır.
 *
 * Tarayıcı sekmeleri arasında doğrudan nesne paylaşılamadığı için küçük bir
 * kayıt `localStorage`'a yazılır. Kaynak sekme dosyayı yüklerken hedef sekme
 * aynı kaydı dinler; hazır olunca dosyayı kendi stüdyosuna bağlar ve kaydı siler.
 */
import type { LocalFileResponse } from "@/lib/types"

const KEY_PREFIX = "clip2:incoming:"
/** Açılıp hiç okunmayan kayıtların birikmemesi için üst sınır. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000

export type ProjectHandoffStatus = "uploading" | "ready" | "error" | "cancelled"

export interface ProjectHandoff {
  status: ProjectHandoffStatus
  /** Özgün dosya adı (yükleme bitmeden önce de gösterilebilir). */
  name: string
  createdAt: number
  /** Yalnızca `status === "ready"` iken dolu. */
  result?: LocalFileResponse
  /** Yalnızca `status === "error"` iken dolu. */
  error?: string
}

export function projectKey(id: string): string {
  return `${KEY_PREFIX}${id}`
}

function isHandoff(value: unknown): value is ProjectHandoff {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<ProjectHandoff>
  return (
    (candidate.status === "uploading" ||
      candidate.status === "ready" ||
      candidate.status === "error" ||
      candidate.status === "cancelled") &&
    typeof candidate.name === "string" &&
    typeof candidate.createdAt === "number"
  )
}

/** Eski kayıtları temizler; hata durumunda sessizce devam eder. */
function cleanupOld(): void {
  try {
    const now = Date.now()
    const stale: string[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key?.startsWith(KEY_PREFIX)) continue
      try {
        const parsed = JSON.parse(window.localStorage.getItem(key) ?? "") as Partial<ProjectHandoff>
        if (typeof parsed.createdAt !== "number" || now - parsed.createdAt > MAX_AGE_MS) {
          stale.push(key)
        }
      } catch {
        stale.push(key)
      }
    }
    stale.forEach((key) => window.localStorage.removeItem(key))
  } catch {
    /* localStorage kullanılamıyorsa temizlik atlanır */
  }
}

export function writeProjectHandoff(id: string, handoff: ProjectHandoff): boolean {
  try {
    cleanupOld()
    window.localStorage.setItem(projectKey(id), JSON.stringify(handoff))
    return true
  } catch {
    return false
  }
}

export function readProjectHandoff(id: string): ProjectHandoff | null {
  try {
    const raw = window.localStorage.getItem(projectKey(id))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isHandoff(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function removeProjectHandoff(id: string): void {
  try {
    window.localStorage.removeItem(projectKey(id))
  } catch {
    /* yok sayılır */
  }
}
