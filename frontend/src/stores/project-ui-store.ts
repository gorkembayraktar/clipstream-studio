/** Proje çalışma alanının UI durumu: sağ panel sekmesi/açıklığı, ayarlar penceresi. */
import { create } from "zustand"

/** Sağ paneldeki sekmeler. Kaynak artık ana sayfada; ayarlar üst menüde. */
export type PanelTab = "export" | "gallery"

/** Ayarlar penceresindeki bölümler (sol gezinme). */
export type SettingsSection =
  | "general"
  | "playback"
  | "logs"
  | "shortcuts"
  | "about"

const HISTORY_OPEN_KEY = "clip2:project-history-open"
const PANEL_OPEN_KEY = "clip2:side-panel-open"

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : raw === "true"
  } catch {
    return fallback
  }
}

function persistBool(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    /* gizli sekme vb. durumlarda sessizce yok sayılır */
  }
}

/** Eski proje kayıtlarında kalan geçersiz sekmeler varsayılana düşer. */
export function toPanelTab(value: unknown): PanelTab {
  return value === "gallery" ? "gallery" : "export"
}

interface ProjectUiState {
  panelTab: PanelTab
  /** Sağ panel açık mı? (Videoya daha fazla alan bırakmak için kapatılabilir.) */
  panelOpen: boolean
  /** Ayarlar penceresi (üst menüden açılır). */
  settingsOpen: boolean
  /** Ayarlar penceresinde açık bölüm. */
  settingsSection: SettingsSection
  historyOpen: boolean
  /** Yeni proje akışında kaynak alanına odaklanmak için sayaç. */
  sourceFocusNonce: number
  setPanelTab: (tab: PanelTab) => void
  setPanelOpen: (open: boolean) => void
  togglePanel: () => void
  setSettingsOpen: (open: boolean, section?: SettingsSection) => void
  setSettingsSection: (section: SettingsSection) => void
  setHistoryOpen: (open: boolean) => void
  requestSourceFocus: () => void
}

export const useProjectUiStore = create<ProjectUiState>()((set) => ({
  panelTab: "export",
  panelOpen: readBool(PANEL_OPEN_KEY, true),
  settingsOpen: false,
  settingsSection: "general",
  historyOpen: readBool(HISTORY_OPEN_KEY, false),
  sourceFocusNonce: 0,
  setPanelTab: (panelTab) => set({ panelTab }),
  setPanelOpen: (panelOpen) => {
    persistBool(PANEL_OPEN_KEY, panelOpen)
    set({ panelOpen })
  },
  togglePanel: () =>
    set((state) => {
      persistBool(PANEL_OPEN_KEY, !state.panelOpen)
      return { panelOpen: !state.panelOpen }
    }),
  setSettingsOpen: (settingsOpen, section) =>
    set((state) => ({
      settingsOpen,
      settingsSection: section ?? state.settingsSection,
    })),
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  setHistoryOpen: (historyOpen) => {
    persistBool(HISTORY_OPEN_KEY, historyOpen)
    set({ historyOpen })
  },
  requestSourceFocus: () =>
    set((state) => ({ sourceFocusNonce: state.sourceFocusNonce + 1 })),
}))
