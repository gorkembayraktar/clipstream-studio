/** Stüdyo durumu: kaynak, kesim aralığı, kırpma ve dışa aktarma seçenekleri. */
import { create } from "zustand"

import { clamp } from "@/lib/format"
import type {
  AspectPreset,
  CropRect,
  CutMode,
  OutputFormat,
  SourcePlatform,
  StreamVariant,
  VideoMeta,
} from "@/lib/types"

interface SourceInfo {
  streamUrl: string
  title: string | null
  resolution: string | null
  /** Kaynak platformu (YouTube/X/Instagram akışları CORS için proxy gerektirir). */
  platform: SourcePlatform
  /** Kopyasız yerel kaynakta dosyanın gerçek yolu (arayüzde gösterilir). */
  sourcePath?: string | null
  /** Video akışı sessizse (ör. YouTube HLS) sesin alınacağı ayrı akış. */
  audioUrl?: string | null
  /** Kaynakta bulunan önizleme kalite varyantları (en yüksek kalite başta). */
  variants?: StreamVariant[]
  /** curl ile yapıştırılan HTTP başlıkları (cookie/referer…). */
  headers?: Record<string, string> | null
  /** Oynatma proxy'sinin başlıkları tanıması için kısa ömürlü belirteç. */
  headerToken?: string | null
}

interface StudioState {
  // Kaynak
  inputUrl: string
  streamUrl: string | null
  title: string | null
  resolution: string | null
  platform: SourcePlatform
  useProxy: boolean
  audioUrl: string | null
  /** Yerel kaynakta gösterilecek konum (dosya yolu/adı); diğerlerinde null. */
  sourcePath: string | null
  /** Kaynakta bulunan önizleme kalite varyantları (en yüksek kalite başta). */
  variants: StreamVariant[]
  /** curl ile yapıştırılan HTTP başlıkları (yalnızca doğrudan kaynaklarda). */
  headers: Record<string, string> | null
  /** Oynatma proxy'sinin başlıkları tanıması için belirteç. */
  headerToken: string | null
  /** Önizlemede seçili varyant yüksekliği (null → en yüksek kalite). */
  previewHeight: number | null
  meta: VideoMeta | null
  sourceLoading: boolean

  // Kesim
  trim: { start: number; end: number }
  loop: boolean

  // Kırpma
  crop: { enabled: boolean; rect: CropRect | null; aspect: AspectPreset }

  // Dışa aktarma
  cutMode: CutMode
  outputFormat: OutputFormat
  filename: string
  /** GPU render tercihi; uygun olmayan çıktılarda arayüz tarafından yok sayılır. */
  gpuEnabled: boolean
  /** Sürdürülen/tamamlanan dışa aktarma kartları (paralel işler desteklenir). */
  activeJobIds: string[]

  // Eylemler
  setInputUrl: (url: string) => void
  setUseProxy: (value: boolean) => void
  setSource: (source: SourceInfo) => void
  setPreviewHeight: (height: number) => void
  setMeta: (meta: Partial<VideoMeta>) => void
  setSourceLoading: (value: boolean) => void
  clearSource: () => void
  setTrim: (partial: Partial<{ start: number; end: number }>) => void
  setLoop: (value: boolean) => void
  setCropEnabled: (value: boolean) => void
  setCropRect: (rect: CropRect | null) => void
  setCropAspect: (aspect: AspectPreset) => void
  setCutMode: (mode: CutMode) => void
  setOutputFormat: (format: OutputFormat) => void
  setFilename: (value: string) => void
  setGpuEnabled: (value: boolean) => void
  addActiveJobId: (id: string) => void
  removeActiveJobId: (id: string) => void
}

const roundMs = (value: number) => Math.round(value * 1000) / 1000

/** Giriş/çıkış noktaları arasındaki en küçük klip süresi (sn). */
export const MIN_TRIM_SECONDS = 0.05

export const useStudioStore = create<StudioState>()((set) => ({
  inputUrl: "",
  streamUrl: null,
  title: null,
  resolution: null,
  platform: "direct",
  useProxy: false,
  audioUrl: null,
  sourcePath: null,
  variants: [],
  headers: null,
  headerToken: null,
  previewHeight: null,
  meta: null,
  sourceLoading: false,

  trim: { start: 0, end: 0 },
  loop: false,

  crop: { enabled: false, rect: null, aspect: "free" },

  cutMode: "exact",
  outputFormat: "mp4",
  filename: "",
  gpuEnabled: false,
  activeJobIds: [],

  setInputUrl: (url) => set({ inputUrl: url }),
  setUseProxy: (value) => set({ useProxy: value }),

  setSource: (source) =>
    set({
      streamUrl: source.streamUrl,
      title: source.title,
      resolution: source.resolution,
      platform: source.platform,
      audioUrl: source.audioUrl ?? null,
      sourcePath: source.sourcePath ?? null,
      variants: source.variants ?? [],
      headers: source.headers ?? null,
      headerToken: source.headerToken ?? null,
      previewHeight:
        (source.variants ?? []).find((item) => item.default)?.height ??
        source.variants?.[0]?.height ??
        null,
      meta: null,
      sourceLoading: false,
      trim: { start: 0, end: 0 },
      crop: { enabled: false, rect: null, aspect: "free" },
    }),

  setPreviewHeight: (height) => set({ previewHeight: height }),

  setSourceLoading: (value) => set({ sourceLoading: value }),

  setMeta: (meta) =>
    set((state) => {
      // Kısmi birleştirme: ffprobe fps verirken video elementinin meta verisi
      // (genişlik/yükseklik/süre) onu ezmesin.
      const merged: VideoMeta = {
        width: 0,
        height: 0,
        duration: 0,
        hasAudio: false,
        ...state.meta,
        ...meta,
      }

      const duration = merged.duration || 0
      let { start, end } = state.trim
      if (duration > 0) {
        if (end <= 0 || end > duration) end = duration
        if (start >= end)
          start = clamp(start, 0, Math.max(0, duration - MIN_TRIM_SECONDS))
      }
      return { meta: merged, trim: { start, end } }
    }),

  clearSource: () =>
    set({
      streamUrl: null,
      title: null,
      resolution: null,
      platform: "direct",
      audioUrl: null,
      sourcePath: null,
      variants: [],
      headers: null,
      headerToken: null,
      previewHeight: null,
      meta: null,
      sourceLoading: false,
      trim: { start: 0, end: 0 },
      crop: { enabled: false, rect: null, aspect: "free" },
    }),

  setTrim: (partial) =>
    set((state) => {
      const next = { ...state.trim, ...partial }
      const duration = state.meta?.duration ?? 0
      const max = duration > 0 ? duration : Number.MAX_SAFE_INTEGER
      const minClip = Math.min(MIN_TRIM_SECONDS, max)

      next.start = clamp(roundMs(next.start), 0, max)
      next.end = clamp(roundMs(next.end), 0, max)

      const movedStart = partial.start !== undefined
      const movedEnd = partial.end !== undefined

      // Tutamaklar birbirini geçerse noktalar yer değiştirir: seçim ters çevrilir.
      // Geçiş minimum klip süresinden kısaysa tutamak diğerinin yanında kalır.
      if (next.start > next.end) {
        if (next.start - next.end >= minClip) {
          const previousStart = next.start
          next.start = next.end
          next.end = previousStart
        } else if (movedStart && !movedEnd) {
          next.start = Math.max(0, next.end - minClip)
        } else if (movedEnd && !movedStart) {
          next.end = Math.min(max, next.start + minClip)
        } else {
          next.start = Math.max(0, next.end - minClip)
        }
      }

      // Son güvenlik: klip her zaman en az minClip kadar olsun.
      if (next.end - next.start < minClip) {
        if (movedStart && !movedEnd) next.start = Math.max(0, next.end - minClip)
        else next.end = Math.min(max, next.start + minClip)
      }

      return { trim: next }
    }),

  setLoop: (value) => set({ loop: value }),
  setCropEnabled: (value) =>
    set((state) => ({ crop: { ...state.crop, enabled: value } })),
  setCropRect: (rect) => set((state) => ({ crop: { ...state.crop, rect } })),
  setCropAspect: (aspect) => set((state) => ({ crop: { ...state.crop, aspect } })),

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
  removeActiveJobId: (id) =>
    set((state) => ({
      activeJobIds: state.activeJobIds.filter((item) => item !== id),
    })),
}))
