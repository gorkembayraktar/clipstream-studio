/** Proje akışı: kayıtların ard arda biriktiği tek timeline.
 *
 * Model tek cümlede: **kayıtlar tek bir yayın akışıdır**. Recorder her segmenti
 * doğrudan `cache/streams/<proje>/` altına yazar, backend de bunları tek bir
 * HLS playlist'i olarak servis eder. Bu yüzden "kaydı birleştir", "MP4'e çevir",
 * "şeride geç" gibi ara adımlar yoktur: kayıt biter bitmez akışın bir bloğu olur
 * ve oynatıcı/timeline hep bu akışı gösterir.
 *
 * Bu store yalnızca akışın **özetini** tutar (`blocks`, `duration`, `revision`).
 * Sürüm (`revision`) her segment eklendiğinde/silindiğinde artar; dalga formu ve
 * storyboard önbelleği buna göre tazelenir. Oynatma adresi ise yalnızca yıkıcı
 * değişimde (`playback`) tazelenir: playlist büyüyen bir EVENT listesidir ve
 * kayıt bitince video yeniden yüklenmez.
 */
import { toast } from "sonner"
import { create } from "zustand"

import { translate } from "@/i18n"
import { ApiError, api } from "@/lib/api"
import type { StreamSummary } from "@/lib/types"
import { useEditStore } from "@/stores/edit-store"
import { log } from "@/stores/log-store"
import { usePlayerStore } from "@/stores/player-store"
import { useProjectStore } from "@/stores/project-store"
import {
  onExternalSource,
  streamPlaylistUrl,
  useSourceStore,
} from "@/stores/source-store"

interface StreamState {
  /** Proje kimliği = akış kimliği. */
  streamId: string | null
  /** Akış özeti (bloklar, süre, sürüm); akış yoksa null. */
  summary: StreamSummary | null
  /** Özet backend'den yükleniyor. */
  loading: boolean
  error: string | null

  /** Akışı yükler: proje açılışı/geri yükleme. Akış yoksa null döner. */
  load: (streamId: string) => Promise<StreamSummary | null>
  /** Akışı yeni sürümüyle tazeler (kayıt bitti/silindi). */
  refresh: () => Promise<StreamSummary | null>
  /** Akışı editörün kaynağı yapar (ilk kayıttan sonra bir kez). */
  adopt: (summary: StreamSummary) => void
  /** Kaynak zaten bu akışsa: konumu/oynatmayı koruyarak sürümü uygular. */
  apply: (summary: StreamSummary) => void
  /** Akıştaki bir kaydı (bloğu) siler. */
  removeRecording: (recordingId: string) => Promise<boolean>
  reset: () => void
}

function describe(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return translate("api.unreachable")
}

export const useStreamStore = create<StreamState>()((set, get) => ({
  streamId: null,
  summary: null,
  loading: false,
  error: null,

  load: async (streamId) => {
    set({ streamId, loading: true, error: null })
    try {
      const summary = await api.stream(streamId, { silent: true })
      set({ summary, loading: false })
      return summary
    } catch (error) {
      // Hiç kayıt alınmamış projede akış yoktur: bu bir hata değil.
      const missing = error instanceof ApiError && error.status === 404
      const message = missing ? null : describe(error)
      set({ summary: null, loading: false, error: message })
      if (message) log("error", translate("stream.loadFailed"), message)
      return null
    }
  },

  refresh: async () => {
    // Proje kimliği akış kimliğidir; store'da kalmış eski bir akış kimliği
    // (önceki proje) yeni kaydı yanlış akışa bağlar. Bu yüzden önce proje.
    const streamId = useProjectStore.getState().projectId ?? get().streamId
    if (!streamId) return null
    try {
      const summary = await api.stream(streamId, { silent: true })
      set({ streamId, summary, error: null })
      return summary
    } catch (error) {
      const missing = error instanceof ApiError && error.status === 404
      set({ streamId, summary: null, error: missing ? null : describe(error) })
      return null
    }
  },

  adopt: (summary) => {
    set({ streamId: summary.id, summary, error: null })
    // Proje kimliği burada **değiştirilmez**: akış kimliği proje kimliğidir ve
    // proje kimliğini store'a yazmak, çalışma zamanındaki kimlikle (ref) iki
    // başlı hale gelir; sonuçta aynı kayıt için yeni/boş bir proje açılır.
    // Canlı önizlemeden kaydedilmiş akışa geçiyoruz: canlıdaki kesimler anlamsız.
    useEditStore.getState().resetEdit()
    useSourceStore.getState().setStreamSource(summary)
    // Kullanıcıyı yeni kaydın başına getir: "ne kaydettim?" hemen görünsün.
    const newest = summary.blocks[summary.blocks.length - 1]
    usePlayerStore.getState().requestSeek(newest ? newest.start : 0)
  },

  apply: (summary) => {
    const source = useSourceStore.getState()
    if (source.streamId !== summary.id) {
      get().adopt(summary)
      return
    }

    const changed = source.streamUrl !== streamPlaylistUrl(summary.url, summary.playback)
    if (changed) {
      // Yalnızca yıkıcı değişimde (blok silme) adres tazelenir: EVENT playlist
      // büyürken oynatıcı kendiliğinden devam eder, video yeniden yüklenmez.
      const player = usePlayerStore.getState()
      const limit = Math.max(0, summary.duration - 0.1)
      player.requestSeek(Math.min(player.currentTime, limit))
      if (player.playing) player.requestPlay()
    }

    set({ streamId: summary.id, summary, error: null })
    useSourceStore.getState().syncStreamMeta(summary)
  },

  removeRecording: async (recordingId) => {
    const streamId = get().streamId ?? useProjectStore.getState().projectId
    if (!streamId) return false
    try {
      const summary = await api.deleteStreamRecording(streamId, recordingId)
      if (summary.blocks.length === 0) {
        // Son kayıt da silindi: timeline boş, kaynak kapanır.
        set({ streamId, summary: null })
        useSourceStore.getState().clearSource()
        return true
      }
      get().apply(summary)
      // Akıştan bir blok fiziksel olarak çıktı: kaynak zamanı kaydı, dolayısıyla
      // makas izleri geçersiz. Parçalar `clampTrimToDuration` ile yeniden kurulur.
      useEditStore.getState().setSplits([])
      log(
        "success",
        translate("stream.deletedLog"),
        `${summary.blocks.length} blok · ${summary.duration.toFixed(1)} sn`,
      )
      return true
    } catch (error) {
      const message = describe(error)
      log("error", translate("stream.deleteFailed"), message)
      toast.error(translate("stream.deleteFailed"), { description: message })
      return false
    }
  },

  reset: () => set({ streamId: null, summary: null, loading: false, error: null }),
}))

// Akış dışı bir kaynak (URL, yerel dosya) yüklendiğinde akış kapanır.
onExternalSource(() => {
  if (useSourceStore.getState().streamId) return
  useStreamStore.getState().reset()
})
