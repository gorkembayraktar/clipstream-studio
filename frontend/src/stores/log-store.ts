/** Sistem & hata günlüğü (referans projedeki log çekmecesinin karşılığı).
 *
 * Kayıtlar en fazla MAX_ENTRIES adet tutulur; hata kaydı geldiğinde çekmece
 * otomatik olarak açılır. Tarayıcı konsoluna da aynı satır yazılır.
 */
import { create } from "zustand"

import { translate } from "@/i18n"

export type LogLevel = "info" | "success" | "warn" | "error"

export interface LogEntry {
  id: number
  /** "HH:MM:SS.mmm" */
  time: string
  level: LogLevel
  message: string
  extra?: string
}

const MAX_ENTRIES = 500

function stamp(): string {
  const now = new Date()
  const pad = (value: number, size = 2) => String(value).padStart(size, "0")
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  return `${time}.${pad(now.getMilliseconds(), 3)}`
}

function describe(extra: unknown): string | undefined {
  if (extra === undefined || extra === null) return undefined
  if (typeof extra === "string") return extra
  try {
    return JSON.stringify(extra)
  } catch {
    return String(extra)
  }
}

interface LogState {
  entries: LogEntry[]
  errorCount: number
  open: boolean
  nextId: number
  log: (level: LogLevel, message: string, extra?: unknown) => void
  clear: () => void
  setOpen: (open: boolean) => void
  toggle: () => void
}

const STARTUP_ENTRY: LogEntry = {
  id: 1,
  time: stamp(),
  level: "info",
  message: translate("logs.startup"),
}

export const useLogStore = create<LogState>((set, get) => ({
  entries: [STARTUP_ENTRY],
  errorCount: 0,
  open: false,
  nextId: 2,

  log: (level, message, extra) => {
    const entry: LogEntry = {
      id: get().nextId,
      time: stamp(),
      level,
      message,
      extra: describe(extra),
    }

    const line = `[ClipStream] ${message}`
    if (level === "error") console.error(line, extra ?? "")
    else if (level === "warn") console.warn(line, extra ?? "")
    else console.log(line, extra ?? "")

    set((state) => {
      const entries = [...state.entries, entry]
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
      return {
        entries,
        nextId: state.nextId + 1,
        errorCount: state.errorCount + (level === "error" ? 1 : 0),
        // Hata kaydında çekmece kendiliğinden açılır (referans davranışı)
        open: level === "error" ? true : state.open,
      }
    })
  },

  clear: () => {
    set({ entries: [], errorCount: 0 })
    get().log("info", translate("log.cleared"))
  },

  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
}))

/** React dışından (ör. api katmanı) kayıt eklemek için kısayol. */
export const log = (level: LogLevel, message: string, extra?: unknown) =>
  useLogStore.getState().log(level, message, extra)
