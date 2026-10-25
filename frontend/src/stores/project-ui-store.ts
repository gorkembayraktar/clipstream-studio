/** Proje çalışma alanının UI durumu (sağ paneldeki aktif sekme). */
import { create } from "zustand"

export type PanelTab = "source" | "export" | "gallery" | "settings"

interface ProjectUiState {
  panelTab: PanelTab
  setPanelTab: (tab: PanelTab) => void
}

export const useProjectUiStore = create<ProjectUiState>()((set) => ({
  panelTab: "source",
  setPanelTab: (panelTab) => set({ panelTab }),
}))
