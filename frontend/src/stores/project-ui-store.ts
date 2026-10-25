/** Proje çalışma alanının UI durumu (sağ paneldeki aktif sekme). */
import { create } from "zustand"

export type PanelTab = "source" | "export" | "gallery" | "settings"

const HISTORY_OPEN_KEY = "clip2:project-history-open"

function readHistoryOpen(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(HISTORY_OPEN_KEY) === "true"
  } catch {
    return false
  }
}

function persistHistoryOpen(open: boolean) {
  try {
    window.localStorage.setItem(HISTORY_OPEN_KEY, String(open))
  } catch {
    /* gizli sekme vb. durumlarda sessizce yok sayılır */
  }
}

interface ProjectUiState {
  panelTab: PanelTab
  historyOpen: boolean
  setPanelTab: (tab: PanelTab) => void
  setHistoryOpen: (open: boolean) => void
}

export const useProjectUiStore = create<ProjectUiState>()((set) => ({
  panelTab: "source",
  historyOpen: readHistoryOpen(),
  setPanelTab: (panelTab) => set({ panelTab }),
  setHistoryOpen: (historyOpen) => {
    persistHistoryOpen(historyOpen)
    set({ historyOpen })
  },
}))
