/** Dışa aktarma seçenekleri ve sürdürülen işler. */
import { create } from "zustand"

import type { CutMode, OutputFormat } from "@/lib/types"

interface ExportState {
  cutMode: CutMode
  outputFormat: OutputFormat
  filename: string
  /** GPU render tercihi; uygun olmayan çıktılarda arayüz tarafından yok sayılır. */
  gpuEnabled: boolean
  /** Sürdürülen/tamamlanan dışa aktarma kartları (paralel işler desteklenir). */
  activeJobIds: string[]

  // Eylemler
  setCutMode: (mode: CutMode) => void
  setOutputFormat: (format: OutputFormat) => void
  setFilename: (value: string) => void
  setGpuEnabled: (value: boolean) => void
  addActiveJobId: (id: string) => void
  removeActiveJobIds: (ids: string[]) => void
}

export const useExportStore = create<ExportState>()((set) => ({
  cutMode: "exact",
  outputFormat: "mp4",
  filename: "",
  gpuEnabled: false,
  activeJobIds: [],

  setCutMode: (mode) => set({ cutMode: mode }),
  setOutputFormat: (format) => set({ outputFormat: format }),
  setFilename: (value) => set({ filename: value }),
  setGpuEnabled: (value) => set({ gpuEnabled: value }),
  addActiveJobId: (id) =>
    set((state) =>
      state.activeJobIds.includes(id)
        ? state
        : { activeJobIds: [id, ...state.activeJobIds] },
    ),
  removeActiveJobIds: (ids) =>
    set((state) => {
      const remove = new Set(ids)
      return {
        activeJobIds: state.activeJobIds.filter((id) => !remove.has(id)),
      }
    }),
}))
