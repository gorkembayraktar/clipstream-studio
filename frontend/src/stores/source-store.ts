/** Kaynak durumu: URL çözümleme, yerel içe aktarma ve medya meta verileri. */
import { create } from "zustand"

import type {
  HlsAudioTrack,
  HlsSubtitleTrack,
  SourcePlatform,
  StreamSummary,
  StreamVariant,
  TimelineAnchor,
  TimelineAnchorPoint,
  VideoMeta,
} from "@/lib/types"
import { useEditStore } from "@/stores/edit-store"

/**
 * Zaman çizelgesindeki bir anı medya sırasına çevirir.
 *
 * Harita, oynatıcının son okuduğu pencereden gelir; `time` pencerenin
 * dışındaysa `null` döner (içerik artık indirilemez).
 */
export function anchorAtTime(
  anchor: TimelineAnchor,
  time: number,
): TimelineAnchorPoint | null {
  let cursor = anchor.start_time
  if (time < cursor) return null
  for (let index = 0; index < anchor.durations.length; index += 1) {
    const duration = anchor.durations[index]
    if (duration <= 0) continue
    if (time < cursor + duration) {
      return { sequence: anchor.start_sequence + index, time: cursor }
    }
    cursor += duration
  }
  return null
}

interface SourceInfo {
  streamUrl: string
  title: string | null
  resolution: string | null
  /** Kaynak platformu (YouTube/X/Instagram akışları CORS için proxy gerektirir). */
  platform: SourcePlatform
  /** Kopyasız yerel kaynakta dosyanın gerçek yolu (arayüzde gösterilir). */
  sourcePath?: string | null
  /** Yerel kaynak tarayıcı için geçici olarak remux edildi mi? */
  previewCopy?: boolean
  /** Kaynağın yüklendiği özgün adres (HLS master / sayfa URL'si). */
  originUrl?: string | null
  /** Video akışı sessizse (ör. YouTube HLS) sesin alınacağı ayrı akış. */
  audioUrl?: string | null
  /** Master playlist'teki alternatif ses rendition'ları. */
  audioTracks?: HlsAudioTrack[]
  /** Master playlist'teki WebVTT altyazı rendition'ları. */
  subtitleTracks?: HlsSubtitleTrack[]
  /** Kaynakta bulunan önizleme kalite varyantları (en yüksek kalite başta). */
  variants?: StreamVariant[]
  /** Kaynak HLS mi? Uzantısız playlist'lerde backend içerik tespitiyle belirlenir. */
  isHls: boolean
  /** Kaynak canlı yayın mı? Canlı kaynakta süre/kesim/dışa aktarma devre dışıdır. */
  isLive?: boolean
  /** curl ile yapıştırılan HTTP başlıkları (cookie/referer…). */
  headers?: Record<string, string> | null
  /** Oynatma proxy'sinin başlıkları tanıması için kısa ömürlü belirteç. */
  headerToken?: string | null
  /** Kaynak bir proje akışı ise kararlı kimliği (proje kimliği). */
  streamId?: string | null
}

/** Akış dışı bir kaynak yüklendiğinde dinleyicileri (akış store'u) haberdar eder. */
let externalSourceListener: (() => void) | null = null

export function onExternalSource(listener: (() => void) | null): void {
  externalSourceListener = listener
}

/** Akış özetinden oynatma adresi: sürüm sorgusu önbelleği tazeler, yol değişmez. */
export function streamPlaylistUrl(url: string, playback: number): string {
  return playback > 0 ? `${url}?v=${playback}` : url
}

interface SourceState {
  inputUrl: string
  streamUrl: string | null
  title: string | null
  resolution: string | null
  platform: SourcePlatform
  useProxy: boolean
  audioUrl: string | null
  /** Kaynak panelinde seçilebilen alternatif ses rendition'ları. */
  audioTracks: HlsAudioTrack[]
  /** Seçili ses rendition'ının kararlı kimliği (yoksa null). */
  audioTrackId: string | null
  /** Ses parçası değişti, yeni akış henüz oynamaya hazır değil (arayüz göstergesi). */
  audioSwitching: boolean
  /** Oynatma sırasında ses akışı yeni konumun verisini bekliyor (seek sonrası). */
  audioBuffering: boolean
  /** Kaynak panelinde seçilebilen WebVTT altyazıları. */
  subtitleTracks: HlsSubtitleTrack[]
  /** Seçili altyazı kimliği; null → altyazı kapalı. */
  subtitleTrackId: string | null
  /** Yerel kaynakta gösterilecek konum (dosya yolu/adı); diğerlerinde null. */
  sourcePath: string | null
  /** Tarayıcı önizlemesi için geçici bir türev dosya kullanılıyor mu? */
  previewCopy: boolean
  /** Kaynağın yüklendiği özgün adres; URL çubuğu değişse de sabit kalır. */
  sourceOrigin: string | null
  /** Kaynakta bulunan önizleme kalite varyantları (en yüksek kalite başta). */
  variants: StreamVariant[]
  /** Kaynak HLS mi? (uzantısız playlist'ler dahil) */
  isHls: boolean
  /** Kaynak canlı yayın mı? */
  isLive: boolean
  /** curl ile yapıştırılan HTTP başlıkları (yalnızca doğrudan kaynaklarda). */
  headers: Record<string, string> | null
  /** Oynatma proxy'sinin başlıkları tanıması için belirteç. */
  headerToken: string | null
  /** Önizlemede seçili varyant yüksekliği (null → en yüksek kalite). */
  previewHeight: number | null
  meta: VideoMeta | null
  sourceLoading: boolean
  /** Kaynak bir proje akışı ise kararlı kimliği (proje kimliği). */
  streamId: string | null
  /** Kayıt için kullanılacak çözümlenmiş canlı yayın adresi (yoksa null). */
  liveUrl: string | null
  /**
   * Sahne canlı yayını mı gösteriyor? Kayıt alındıktan sonra kaynak proje
   * akışına döner; kullanıcı "Canlı" düğmesiyle yayını izlemeye devam eder.
   * Yalnızca görüntüyü değiştirir (proje/kimlik korunur).
   */
  previewLive: boolean
  /**
   * Oynatıcının son okuduğu HLS penceresinin zaman çizelgesi haritası.
   * Canlı/DVR kaynaklarda pencere kaydığı için dışa aktarma sınırları bu
   * haritayla medya sırasına çevrilir; VOD kaynakta kullanılmaz.
   */
  timelineAnchor: TimelineAnchor | null

  // Eylemler
  setInputUrl: (url: string) => void
  setUseProxy: (value: boolean) => void
  setSource: (source: SourceInfo) => void
  /** Proje akışını kaynak yapar: timeline/oynatıcı artık kaydedilmiş akıştır. */
  setStreamSource: (summary: StreamSummary) => void
  /** Akışı yeniden bağlamadan süre/meta bilgisini tazeler. */
  syncStreamMeta: (summary: StreamSummary) => void
  /** Kayıt için çözümlenen canlı yayın adresini hatırlar. */
  setLiveUrl: (url: string | null) => void
  /** Sahneyi canlı yayına / kayda alır (yalnızca görüntü modu). */
  setPreviewLive: (value: boolean) => void
  setAudioTrackId: (id: string) => void
  setAudioSwitching: (value: boolean) => void
  setAudioBuffering: (value: boolean) => void
  setSubtitleTrackId: (id: string | null) => void
  setPreviewHeight: (height: number) => void
  setMeta: (meta: Partial<VideoMeta>) => void
  setSourceLoading: (value: boolean) => void
  setTimelineAnchor: (anchor: TimelineAnchor | null) => void
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
  audioTracks: [],
  audioTrackId: null,
  audioSwitching: false,
  audioBuffering: false,
  subtitleTracks: [],
  subtitleTrackId: null,
  sourcePath: null,
  previewCopy: false,
  sourceOrigin: null,
  variants: [],
  isHls: false,
  isLive: false,
  headers: null,
  headerToken: null,
  previewHeight: null,
  meta: null,
  sourceLoading: false,
  timelineAnchor: null,
  streamId: null,
  liveUrl: null,
  previewLive: false,

  setInputUrl: (url) => set({ inputUrl: url }),
  setUseProxy: (value) => set({ useProxy: value }),

  setSource: (source) => {
    // Kaynak değişince kesim/kırpma sıfırlanır (edit-store'a ait durum).
    useEditStore.getState().resetEdit()

    // Üst düzey liste boşsa varsayılan/en yüksek varyantın ses grubuna düş.
    const variants = source.variants ?? []
    const defaultVariant = variants.find((item) => item.default) ?? variants[0]
    const audioTracks =
      source.audioTracks && source.audioTracks.length > 0
        ? source.audioTracks
        : (defaultVariant?.audio_tracks ?? [])
    // Arayüz diline göre otomatik seçim yapılmaz: kaynağın kendi varsayılanı
    // (YouTube'da özgün dil) seçilir, kullanıcı listeden istediği dublajı seçer.
    const defaultTrack =
      audioTracks.find((track) => track.default) ??
      audioTracks.find((track) => track.original) ??
      audioTracks.find((track) => track.autoselect) ??
      audioTracks[0] ??
      null
    const subtitleTracks =
      source.subtitleTracks && source.subtitleTracks.length > 0
        ? source.subtitleTracks
        : (defaultVariant?.subtitle_tracks ?? [])

    set({
      streamUrl: source.streamUrl,
      title: source.title,
      resolution: source.resolution,
      platform: source.platform,
      audioUrl: defaultTrack?.url ?? source.audioUrl ?? null,
      audioTracks,
      audioTrackId: defaultTrack?.id ?? null,
      audioSwitching: false,
      audioBuffering: false,
      subtitleTracks,
      subtitleTrackId: null,
      sourcePath: source.sourcePath ?? null,
      previewCopy: source.previewCopy ?? false,
      sourceOrigin: source.originUrl ?? null,
      variants,
      isHls: source.isHls,
      isLive: source.isLive ?? false,
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
      // Yeni kaynak → oynatıcı zaman çizelgesi yeni baştan kurulacak.
      timelineAnchor: null,
      streamId: source.streamId ?? null,
      // Canlı kaynak: kayıt bu adresten yapılır. VOD/yerel kaynakta yok.
      liveUrl: source.isLive ? source.streamUrl : null,
      // Yeni kaynak: sahne kaynağın kendisini gösterir.
      previewLive: false,
    })

    // Akış dışı bir kaynak yüklendi: açık akış kapanır. Bu bildirim **durum
    // yazıldıktan sonra** yapılmalı; aksi halde `streamId` hâlâ önceki akışın
    // kimliğini taşır ve akış store'u temizlenmez (sonraki kayıt yanlış akışa
    // bağlanır, proje kimliği bölünür).
    if (!source.streamId) externalSourceListener?.()
  },

  setStreamSource: (summary) => {
    // Kaynak gerçekten değişiyorsa (proje açılışı) kesimler sıfırlanır;
    // aynı akışta yalnızca süre tazeleniyorsa (kayıt eklendi) düzen korunur.
    if (get().streamId !== summary.id) useEditStore.getState().resetEdit()
    set({
      streamUrl: streamPlaylistUrl(summary.url, summary.playback),
      title: summary.title,
      resolution:
        summary.width > 0 && summary.height > 0
          ? `${summary.width}×${summary.height}`
          : null,
      platform: "local",
      streamId: summary.id,
      audioUrl: null,
      audioTracks: [],
      audioTrackId: null,
      audioSwitching: false,
      audioBuffering: false,
      subtitleTracks: [],
      subtitleTrackId: null,
      sourcePath: null,
      previewCopy: false,
      // Dalga formu/storyboard önbelleği her kayıtta tazelenir.
      sourceOrigin: `stream:${summary.id}#${summary.revision}`,
      variants: [],
      isHls: true,
      isLive: false,
      headers: null,
      headerToken: null,
      previewHeight: null,
      sourceLoading: false,
      timelineAnchor: null,
      // Kayıt eklendi: sahne yeni kayda döner (canlı önizleme kapanır).
      previewLive: false,
    })
    get().setMeta({
      width: summary.width,
      height: summary.height,
      duration: summary.duration,
      hasAudio: summary.has_audio,
      fps: summary.fps > 0 ? summary.fps : undefined,
    })
  },

  syncStreamMeta: (summary) => {
    if (get().streamId !== summary.id) return
    const before = get().meta?.duration ?? 0
    set({
      streamUrl: streamPlaylistUrl(summary.url, summary.playback),
      title: summary.title,
      sourceOrigin: `stream:${summary.id}#${summary.revision}`,
      resolution:
        summary.width > 0 && summary.height > 0
          ? `${summary.width}×${summary.height}`
          : null,
    })
    get().setMeta({
      width: summary.width,
      height: summary.height,
      duration: summary.duration,
      hasAudio: summary.has_audio,
      fps: summary.fps > 0 ? summary.fps : undefined,
    })
    // Akış büyüdüyse çizelge de büyür: yeni kayıt bloğu görünür kalır.
    if (summary.duration > before) {
      useEditStore.getState().extendToDuration(before, summary.duration)
    }
  },

  setAudioTrackId: (id) => {
    const track = get().audioTracks.find((item) => item.id === id)
    if (!track) return
    // Aynı akışa dönüldüyse yükleme göstergesi açılmaz.
    const switching = track.url !== get().audioUrl
    set({ audioTrackId: track.id, audioUrl: track.url, audioSwitching: switching })
  },

  setAudioSwitching: (value) => set({ audioSwitching: value }),

  setAudioBuffering: (value) => {
    if (get().audioBuffering === value) return
    set({ audioBuffering: value })
  },

  setSubtitleTrackId: (id) => {
    if (id === null) {
      set({ subtitleTrackId: null })
      return
    }
    const track = get().subtitleTracks.find((item) => item.id === id)
    if (!track) return
    set({ subtitleTrackId: track.id })
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
      audioTracks: [],
      audioTrackId: null,
      audioSwitching: false,
      audioBuffering: false,
      subtitleTracks: [],
      subtitleTrackId: null,
      sourcePath: null,
      previewCopy: false,
      sourceOrigin: null,
      variants: [],
      isHls: false,
      isLive: false,
      headers: null,
      headerToken: null,
      previewHeight: null,
      meta: null,
      sourceLoading: false,
      timelineAnchor: null,
      streamId: null,
      liveUrl: null,
      previewLive: false,
    })

    // Akış store'u **durum yazıldıktan sonra** kapatılır (yukarıdaki
    // `setSource` ile aynı kural: dinleyici güncel `streamId`'yi görmeli).
    externalSourceListener?.()
  },

  setTimelineAnchor: (anchor) => set({ timelineAnchor: anchor }),

  setLiveUrl: (liveUrl) => set({ liveUrl }),

  setPreviewLive: (value) => {
    // Canlı adres yoksa (ör. VOD kaynak) canlı önizleme açılmaz.
    if (value && !get().liveUrl) return
    if (get().previewLive === value) return
    // Canlı önizleme açıkken zaman çizelgesi anlamsızdır (kayan pencere).
    if (value) {
      useEditStore.getState().setSelection(null)
      set({ previewLive: true, timelineAnchor: null })
      return
    }
    set({ previewLive: false, timelineAnchor: null })
  },
}))
