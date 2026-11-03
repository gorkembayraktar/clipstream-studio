/** Dışa aktarma seçenekleri ve sürdürülen işler. */
import { create } from "zustand"

import type {
  AudioMode,
  CutMode,
  ExportCodec,
  ExportQuality,
  OutputFormat,
  OutputScale,
} from "@/lib/types"

interface ExportState {
  cutMode: CutMode
  outputFormat: OutputFormat
  quality: ExportQuality
  codec: ExportCodec
  /** 30 gibi bir sınır; null kaynağın kare hızını korur. */
  outputFps: number | null
  /** Çıktı yüksekliği; null kaynağın çözünürlüğünü korur. */
  outputScale: OutputScale
  /** Ses işleme: auto | voice | strip. */
  audioMode: AudioMode
  filename: string
  /** GPU render tercihi; uygun olmayan çıktılarda arayüz tarafından yok sayılır. */
  gpuEnabled: boolean
  /** Sürdürülen/tamamlanan dışa aktarma kartları (paralel işler desteklenir). */
  activeJobIds: string[]

  // Eylemler
  setCutMode: (mode: CutMode) => void
  setOutputFormat: (format: OutputFormat) => void
  setQuality: (quality: ExportQuality) => void
  setCodec: (codec: ExportCodec) => void
  setOutputFps: (fps: number | null) => void
  setOutputScale: (scale: OutputScale) => void
  setAudioMode: (mode: AudioMode) => void
  setFilename: (value: string) => void
  setGpuEnabled: (value: boolean) => void
  addActiveJobId: (id: string) => void
  removeActiveJobIds: (ids: string[]) => void
}

export const useExportStore = create<ExportState>()((set) => ({
  cutMode: "exact",
  outputFormat: "mp4",
  quality: "balanced",
  codec: "h264",
  outputFps: null,
  outputScale: null,
  audioMode: "auto",
  filename: "",
  gpuEnabled: false,
  activeJobIds: [],

  setCutMode: (mode) => set({ cutMode: mode }),
  setOutputFormat: (format) => set({ outputFormat: format }),
  setQuality: (quality) => set({ quality }),
  setCodec: (codec) => set({ codec }),
  setOutputFps: (fps) => set({ outputFps: fps }),
  setOutputScale: (scale) => set({ outputScale: scale }),
  setAudioMode: (mode) => set({ audioMode: mode }),
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
