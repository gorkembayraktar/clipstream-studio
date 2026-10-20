/** Tema yönetimi: seçim <html> sınıfına uygulanır ve tarayıcıda saklanır.
 *
 * Koyu tema varsayılandır; "light" seçildiğinde `:root` değişkenleri kullanılır.
 */
import { create } from "zustand"

export type ThemeName = "dark" | "light"

const STORAGE_KEY = "clip2:theme"

function readTheme(): ThemeName {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === "light" || raw === "dark") return raw
  } catch {
    /* gizli sekme vb. durumlarda varsayılan kullanılır */
  }
  return "dark"
}

function applyTheme(theme: ThemeName) {
  const root = document.documentElement
  root.classList.toggle("dark", theme === "dark")
  root.classList.toggle("light", theme === "light")
  root.style.colorScheme = theme
}

/** İlk boyamadan önce uygula: modül yüklenirken sınıf hazır olur. */
const initialTheme = readTheme()
if (typeof document !== "undefined") applyTheme(initialTheme)

interface ThemeState {
  theme: ThemeName
  setTheme: (theme: ThemeName) => void
  toggleTheme: () => void
}

export const useThemeStore = create<ThemeState>()((set, get) => ({
  theme: initialTheme,

  setTheme: (theme) => {
    applyTheme(theme)
    try {
      window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      /* gizli sekme vb. durumlarda sessizce yok sayılır */
    }
    set({ theme })
  },

  toggleTheme: () => {
    const next: ThemeName = get().theme === "dark" ? "light" : "dark"
    get().setTheme(next)
  },
}))
