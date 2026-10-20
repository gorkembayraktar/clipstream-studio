/** Biçimlendirme ve sayı yardımcıları. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Baytı okunur biçime çevirir: "950 KB", "4,3 GB" (Türkçe ondalık virgül). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exponent
  const digits = exponent === 0 ? 0 : value >= 100 ? 0 : 1
  return `${value.toFixed(digits).replace(".", ",")} ${units[exponent]}`
}

/** Dosya adından uzantıyı atar: "klip.mp4" → "klip". */
export function stripExtension(name: string): string {
  return name.replace(/\.[^.\\/]+$/, "").trim()
}

/** Saniyeyi "HH:MM:SS" (isteğe bağlı ".mmm") biçimine çevirir. */
export function formatTime(seconds: number, withMs = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const base = [hours, minutes, secs].map((v) => String(v).padStart(2, "0")).join(":")
  if (!withMs) return base
  const ms = Math.floor((seconds % 1) * 1000)
  return `${base}.${String(ms).padStart(3, "0")}`
}

/** Timeline çentikleri için kısa saat: "12:34" / "1:02:03" */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`
}

/** "21.4 sn" / "1 dk 05 sn" gibi kompakt süre metni. */
export function compactDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0 sn"
  if (seconds < 60) return `${seconds.toFixed(1)} sn`
  const minutes = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return `${minutes} dk ${String(secs).padStart(2, "0")} sn`
}

/** Kullanıcı girdisini ("01:23:45.678", "12.5", "1:30") saniyeye çevirir. */
export function parseTimeInput(text: string): number | null {
  const cleaned = text.trim().replace(",", ".")
  if (!cleaned) return null

  if (cleaned.includes(":")) {
    const parts = cleaned.split(":")
    if (parts.length > 3) return null
    const numbers = parts.map((part) => Number(part))
    if (numbers.some((n) => Number.isNaN(n) || n < 0)) return null
    return numbers.reduce((acc, n) => acc * 60 + n, 0)
  }

  const value = Number(cleaned)
  return Number.isNaN(value) || value < 0 ? null : value
}
