/** Canlı kayıt durumu: backend'de süren kayıtları yoklar, eylemleri yürütür.
 *
 * Kaydın kendisi backend'de çalışır (segment segment proje akışına yazılır); bu
 * store yalnızca **süren** kayıtları yansıtır. Biten kayıt diye bir liste yoktur:
 * kayıt bittiği anda akışın bir bloğu olur (`stream-store`). Böylece sayfa
 * F5'lense de kayıt durmaz: açılışta `refresh()` aynı kaydı yeniden bağlar.
 */
import { toast } from "sonner"
import { create } from "zustand"

import { translate } from "@/i18n"
import { api, ApiError } from "@/lib/api"
import { formatTime } from "@/lib/format"
import type { Recording, StreamSummary } from "@/lib/types"
import { log } from "@/stores/log-store"
import { useProjectStore } from "@/stores/project-store"
import { useSourceStore } from "@/stores/source-store"
import { useStreamStore } from "@/stores/stream-store"

interface RecorderState {
  /** Yalnızca süren/duraklatılmış kayıtlar (proje başına en fazla bir tane). */
  recordings: Recording[]
  /** Liste en az bir kez okundu mu? (boş liste yanıp sönmesin) */
  loaded: boolean
  /** Bir başlat/durdur/devam işlemi sürüyor (düğmeler kilitlenir). */
  busy: boolean
  refresh: () => Promise<void>
  start: () => Promise<void>
  stop: (id: string) => Promise<void>
  /** Duraklat: akışa ekleme durur, `resume` kaldığı yerden devam eder. */
  pause: (id: string) => Promise<void>
  resume: (id: string) => Promise<void>
  /** Proje değişirken süren kaydı sessizce kapatır (segmentler akışta kalır). */
  stopForProject: (projectId: string) => Promise<void>
}

/** Hata mesajını kullanıcıya gösterilebilir metne çevirir. */
function describe(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return translate("api.unreachable")
}

/** Kayıt adına eklenen saat (aynı kanaldan birden çok kayıt ayrılsın). */
function clockLabel(): string {
  try {
    return new Date().toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return ""
  }
}

export const useRecorderStore = create<RecorderState>()((set, get) => {
  const fail = (error: unknown) =>
    toast.error(translate("record.failed"), { description: describe(error) })

  /** Akışın yeni hâlini uygular (kayıt bitti: segmentler artık akışta). */
  const syncStream = async (): Promise<StreamSummary | null> => {
    const summary = await useStreamStore.getState().refresh()
    if (!summary) return null
    useStreamStore.getState().apply(summary)
    return summary
  }

  /**
   * Kayıt için canlı yayın adresini çözer.
   *
   * Akış kaynağı açıkken `streamUrl` artık kaydedilmiş akıştır; canlı yayın
   * adresi `liveUrl`'de saklanır. Proje geri yüklendiyse (canlı adres yok)
   * kaynak adresi yalnızca burada, kayıt başlatılırken yeniden çözülür.
   */
  const liveUrlFor = async (): Promise<string | null> => {
    const source = useSourceStore.getState()
    if (source.liveUrl) return source.liveUrl
    const input = source.inputUrl.trim()
    if (!input) return null
    const resolved = await api.resolveStream(input, source.headers)
    if (!resolved.stream_url) return null
    useSourceStore.getState().setLiveUrl(resolved.stream_url)
    return resolved.stream_url
  }

  return {
    recordings: [],
    loaded: false,
    busy: false,

    refresh: async () => {
      const previous = new Map(
        get().recordings.map((item) => [item.id, item.status] as const),
      )
      let next: Recording[]
      try {
        const response = await api.recordings({ silent: true })
        // Kayıtlar projeye özeldir: başka projenin süren kaydı gösterilmez.
        // Bu sekmede başlatılan kayıt, kaynak değişse de listede kalır ki
        // kullanıcı onu durdurabilsin.
        const projectId = useProjectStore.getState().projectId
        const seen = new Set(get().recordings.map((item) => item.id))
        next = response.recordings.filter(
          (record) =>
            !record.project_id ||
            record.project_id === projectId ||
            seen.has(record.id),
        )
      } catch {
        // Ağ hatası: liste son hâliyle kalır (kayıt backend'de sürer).
        return
      }

      set({ recordings: next, loaded: true })

      // Kayıt listeden düştüyse backend'de bitmiştir (süre sınırı, başka
      // sekme): yeni blok akışa eklenmiş olmalı, oynatıcı tazelenir.
      const gone = [...previous.keys()].some(
        (id) => !next.some((record) => record.id === id),
      )
      if (gone) await syncStream()

      for (const record of next) {
        const before = previous.get(record.id)
        if (record.status === "paused" && record.error && before !== "paused") {
          toast.error(translate("record.failed"), { description: record.error })
        }
      }
    },

    start: async () => {
      if (get().busy) return
      const projectId = useProjectStore.getState().projectId
      if (!projectId) {
        toast.error(translate("record.noProject"))
        return
      }

      set({ busy: true })
      try {
        const remembered = Boolean(useSourceStore.getState().liveUrl)
        const url = await liveUrlFor()
        if (!url) {
          toast.error(translate("record.noSource"))
          return
        }

        const source = useSourceStore.getState()
        const label = source.title
          ? `${source.title} · ${clockLabel()}`
          : undefined
        const begin = (target: string) =>
          api.startRecording({
            url: target,
            title: label,
            headers: source.headers,
            header_token: source.headerToken,
            // Segmentler bu projenin akışına yazılır.
            project_id: projectId,
          })

        let record: Recording
        try {
          record = await begin(url)
        } catch (error) {
          // Hatırlanan canlı adres (özellikle geri yüklenen projede) süresi
          // dolmuş olabilir: bir kez yeniden çözüp tekrar denenir.
          if (!remembered || !/^https?:\/\//i.test(source.inputUrl.trim())) {
            throw error
          }
          useSourceStore.getState().setLiveUrl(null)
          const fresh = await liveUrlFor()
          if (!fresh) throw error
          record = await begin(fresh)
        }
        set((state) => ({ recordings: [record, ...state.recordings] }))
        log("success", translate("record.startedLog", { title: record.title }), url)
        toast.success(translate("record.startedTitle"), {
          description: record.title,
        })
      } catch (error) {
        fail(error)
      } finally {
        set({ busy: false })
      }
    },

    stop: async (id) => {
      if (get().busy) return
      const record = get().recordings.find((item) => item.id === id)
      set({ busy: true })
      try {
        await api.stopRecording(id)
        set((state) => ({
          recordings: state.recordings.filter((item) => item.id !== id),
        }))
        // Durdurma anında: segmentler zaten akışta, dönüştürme beklemesi yok.
        const summary = await syncStream()
        const newest = summary?.blocks[summary.blocks.length - 1]
        log("info", translate("record.stoppedLog", { title: record?.title ?? "" }))
        toast.success(translate("record.stoppedTitle"), {
          description: newest
            ? `${newest.title} · ${formatTime(newest.end - newest.start)}`
            : undefined,
        })
      } catch (error) {
        fail(error)
      } finally {
        set({ busy: false })
      }
    },

    pause: async (id) => {
      if (get().busy) return
      set({ busy: true })
      try {
        const record = await api.pauseRecording(id)
        set((state) => ({
          recordings: state.recordings.map((item) =>
            item.id === record.id ? record : item,
          ),
        }))
        log("info", translate("record.pausedLog"))
      } catch (error) {
        fail(error)
      } finally {
        set({ busy: false })
      }
    },

    resume: async (id) => {
      if (get().busy) return
      set({ busy: true })
      try {
        const record = await api.resumeRecording(id)
        set((state) => ({
          recordings: state.recordings.map((item) =>
            item.id === record.id ? record : item,
          ),
        }))
        log("info", translate("record.resumedLog"))
      } catch (error) {
        fail(error)
      } finally {
        set({ busy: false })
      }
    },

    stopForProject: async (projectId) => {
      const record = get().recordings.find(
        (item) => !item.project_id || item.project_id === projectId,
      )
      if (!record) return
      try {
        await api.stopRecording(record.id)
        log("info", translate("record.stoppedLog", { title: record.title }))
      } catch (error) {
        log("warn", translate("record.failed"), describe(error))
      }
      set((state) => ({
        recordings: state.recordings.filter((item) => item.id !== record.id),
      }))
    },
  }
})
