/** Kaynak durumu: URL çözümleme, yerel içe aktarma ve medya meta verileri. */
import { create } from "zustand"

import type { SourcePlatform, StreamVariant, VideoMeta } from "@/lib/types"
import { useEditStore } from "@/stores/edit-store"

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
  /** Kaynak HLS mi? Uzantısız playlist'lerde backend içerik tespitiyle belirlenir. */
  isHls: boolean
  /** curl ile yapıştırılan HTTP başlıkları (cookie/referer…). */
  headers?: Record<string, string> | null
  /** Oynatma proxy'sinin başlıkları tanıması için kısa ömürlü belirteç. */
  headerToken?: string | null
}

interface SourceState {
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
  /** Kaynak HLS mi? (uzantısız playlist'ler dahil) */
  isHls: boolean
  /** curl ile yapıştırılan HTTP başlıkları (yalnızca doğrudan kaynaklarda). */
  headers: Record<string, string> | null
  /** Oynatma proxy'sinin başlıkları tanıması için belirteç. */
  headerToken: string | null
  /** Önizlemede seçili varyant yüksekliği (null → en yüksek kalite). */
  previewHeight: number | null
  meta: VideoMeta | null
  sourceLoading: boolean

  // Eylemler
  setInputUrl: (url: string) => void
  setUseProxy: (value: boolean) => void
  setSource: (source: SourceInfo) => void
  setPreviewHeight: (height: number) => void
  setMeta: (meta: Partial<VideoMeta>) => void
  setSourceLoading: (value: boolean) => void
  clearSource: () => void
}

export const useSourceStore = create<SourceState>()((set, get) => ({
  inputUrl: "",
  streamUrl: null,
  title: null,
  resolution: null,
  platform: "direct",
  useProxy: false,
  audioUrl: null,
  sourcePath: null,
  variants: [],
  isHls: false,
  headers: null,
  headerToken: null,
  previewHeight: null,
  meta: null,
  sourceLoading: false,

  setInputUrl: (url) => set({ inputUrl: url }),
  setUseProxy: (value) => set({ useProxy: value }),

  setSource: (source) => {
    // Kaynak değişince kesim/kırpma sıfırlanır (edit-store'a ait durum).
    useEditStore.getState().resetEdit()
    set({
      streamUrl: source.streamUrl,
      title: source.title,
      resolution: source.resolution,
      platform: source.platform,
      audioUrl: source.audioUrl ?? null,
      sourcePath: source.sourcePath ?? null,
      variants: source.variants ?? [],
      isHls: source.isHls,
      headers: source.headers ?? null,
      headerToken: source.headerToken ?? null,
      previewHeight:
        (source.variants ?? []).find((item) => item.default)?.quality_height ??
        (source.variants ?? []).find((item) => item.default)?.height ??
        source.variants?.[0]?.quality_height ??
        source.variants?.[0]?.height ??
        null,
      meta: null,
      sourceLoading: false,
    })
  },

  setPreviewHeight: (height) => set({ previewHeight: height }),

  setSourceLoading: (value) => set({ sourceLoading: value }),

  setMeta: (meta) => {
    // Kısmi birleştirme: ffprobe fps verirken video elementinin meta verisi
    // (genişlik/yükseklik/süre) onu ezmesin.
    const merged: VideoMeta = {
      width: 0,
      height: 0,
      duration: 0,
      hasAudio: false,
      ...get().meta,
      ...meta,
    }

    // Trim aralığı kaynak süresine göre sınırlanır (edit-store davranışı).
    useEditStore.getState().clampTrimToDuration(merged.duration || 0)
    set({ meta: merged })
  },

  clearSource: () => {
    // Kaynak temizlenince kesim/kırpma sıfırlanır (edit-store'a ait durum).
    useEditStore.getState().resetEdit()
    set({
      streamUrl: null,
      title: null,
      resolution: null,
      platform: "direct",
      audioUrl: null,
      sourcePath: null,
      variants: [],
      isHls: false,
      headers: null,
      headerToken: null,
      previewHeight: null,
      meta: null,
      sourceLoading: false,
    })
  },
}))
