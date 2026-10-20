/** Bilgisayardan dosya seçme / pencereye sürükleme: yükleme durumu ve kaynak oluşturma.
 *
 * İki yol vardır:
 * - **Gözat (kopyasız):** Sunucu Windows dosya penceresini açar; seçilen dosya
 *   yerinde kalır, ffmpeg/oynatıcı doğrudan onu okur.
 * - **Sürükle-bırak / tarayıcı seçicisi (kopyalı):** Tarayıcı dosyanın yolunu
 *   vermediği için içerik sunucuya yüklenir; geçici kopya `cache/uploads`'a yazılır.
 *
 * Sürükle-bırakta açık bir proje varsa mevcut proje **bozulmaz**: dosya arka
 * planda yüklenir ve yeni bir sekmede ayrı proje olarak açılır. Hedef sekmeye
 * sonuç `localStorage` üzerinden aktarılır (bkz. `lib/project-handoff.ts`).
 *
 * Her iki yolda da işlem **her aşamada iptal edilebilir**: yükleme bağlantısı
 * kesilir, sunucudaki dosya penceresi kapatılır ve/veya remux süreci durdurulur.
 * İptal düğmesi hem kaynak panelinde hem de sağ alttaki bildirimde görünür.
 */
import { toast } from "sonner"
import { create } from "zustand"

import { ApiError, api } from "@/lib/api"
import { formatBytes, formatTime, stripExtension } from "@/lib/format"
import { writeProjectHandoff } from "@/lib/project-handoff"
import type { LocalFileResponse } from "@/lib/types"
import { log } from "@/stores/log-store"
import { useStudioStore } from "@/stores/studio-store"

const VIDEO_EXTENSIONS = [
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".ts",
  ".mts",
  ".m2ts",
  ".flv",
  ".wmv",
  ".3gp",
  ".ogv",
  ".mpg",
  ".mpeg",
]

const IMPORT_TOAST_ID = "local-import"
const PICK_TOAST_ID = "local-pick"

/** Yüklemenin hedefi: açık proje mi, yeni sekme mi? */
export type LocalImportTarget = "current" | "new-tab"

interface LocalImportState {
  /** Yükleme/hazırlık sürüyor mu? */
  busy: boolean
  /** Kopyasız dosya penceresi / hazırlığı sürüyor mu? */
  picking: boolean
  /** 0–1 arası yükleme oranı (hazırlık aşamasında 1). */
  progress: number | null
  /** Dosya sunucuya gitti, sunucu tarayıcı biçimine hazırlıyor (remux). */
  processing: boolean
  /** Kopyasız seçim bu sistemde kullanılamıyor (tkinter yok vb.). */
  nativeUnavailable: boolean
  fileName: string | null
  /** Seçilen/yüklenen dosyanın boyutu (iptal ve ilerleme metni için). */
  fileSize: number | null
  /** Aktif yüklemenin hedefi (bildirim ve sürükleme katmanı metni için). */
  target: LocalImportTarget | null
  importFile: (file: File) => Promise<void>
  /** Açık projeyi bozmadan dosyayı yeni bir sekmede proje olarak açar. */
  importFileInNewTab: (file: File) => Promise<void>
  pickFile: () => Promise<void>
  /** Devam eden işlemi (yükleme / pencere / remux) iptal eder. */
  cancel: () => void
}

let activeController: AbortController | null = null
let pickController: AbortController | null = null

function isSupportedVideo(file: File): boolean {
  if (file.type.startsWith("video/")) return true
  const name = file.name.toLowerCase()
  return VIDEO_EXTENSIONS.some((extension) => name.endsWith(extension))
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function newProjectId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Bildirimdeki İptal düğmesi: hangi aşamada olursa olsun işlemi durdurur. */
function cancelAction() {
  return {
    label: "İptal",
    onClick: () => useLocalImportStore.getState().cancel(),
  }
}

/** Hazır kaynağı stüdyoya bağlar (her iki yol için ortak). */
function applyLocalSource(result: LocalFileResponse, sourcePath: string | null): void {
  const studio = useStudioStore.getState()
  studio.setUseProxy(false)
  studio.setSource({
    streamUrl: result.url,
    title: result.name,
    resolution: result.width > 0 ? `${result.width}×${result.height}` : null,
    platform: "local",
    sourcePath,
    audioUrl: null,
    variants: [],
  })
  studio.setMeta({
    width: result.width,
    height: result.height,
    duration: result.duration,
    hasAudio: result.has_audio,
    fps: result.fps > 0 ? result.fps : undefined,
  })

  const current = useStudioStore.getState()
  if (!current.filename.trim()) current.setFilename(stripExtension(result.name))

  log(
    "success",
    `Yerel dosya hazır: ${result.name}`,
    `${result.width}×${result.height} · ${formatTime(result.duration)} · ${result.size_mb} MB`,
  )
  if (result.remuxed) {
    log(
      "info",
      "Dosya tarayıcının çalamadığı bir kaptaydı; yeniden kodlanmadan (kayıpsız) MP4/WebM'e dönüştürüldü.",
    )
  }
  toast.success("Dosya hazır", {
    description: `${result.name} · ${result.width}×${result.height} · ${formatTime(result.duration)}`,
  })
}

/** Sunucudaki ağır işi de durdur (pencereyi kapat, remux'u kes). */
function stopServerWork(): void {
  void api.cancelLocal().catch(() => undefined)
}

export const useLocalImportStore = create<LocalImportState>()((set, get) => {
  /** Yüklemeyi iki hedef için ortak yürütür. */
  const runImport = async (file: File, target: LocalImportTarget): Promise<void> => {
    if (get().busy || get().picking) {
      toast.info("Zaten bir dosya hazırlanıyor", {
        description: "Bitmesini bekleyin ya da iptal edin.",
      })
      return
    }

    if (!isSupportedVideo(file)) {
      toast.error("Bu dosya video değil", {
        description: "MP4, WebM, MOV, MKV, AVI gibi bir video dosyası seçin.",
      })
      log("warn", `Desteklenmeyen dosya: ${file.name}`)
      return
    }

    if (file.size === 0) {
      toast.error("Dosya boş", { description: file.name })
      return
    }

    let projectId: string | null = null

    if (target === "new-tab") {
      projectId = newProjectId()
      const wrote = writeProjectHandoff(projectId, {
        status: "uploading",
        name: file.name,
        createdAt: Date.now(),
      })
      if (!wrote) {
        toast.error("Yeni proje açılamadı", {
          description: "Tarayıcı yerel depolamaya yazamıyor; geçici kopya için izin gerekli.",
        })
        log("error", "Yeni proje kaydı oluşturulamadı", "localStorage kullanılamıyor")
        return
      }

      // Sekme, kullanıcı hareketi hâlâ geçerliyken açılmalı; yükleme sonrasına
      // bırakılırsa tarayıcı açılır pencereyi engelleyebilir.
      const projectUrl = new URL(window.location.href)
      projectUrl.search = ""
      projectUrl.hash = ""
      projectUrl.searchParams.set("incoming", projectId)
      const opened = window.open(projectUrl.toString(), "_blank")
      if (!opened) {
        writeProjectHandoff(projectId, {
          status: "error",
          name: file.name,
          createdAt: Date.now(),
          error:
            "Tarayıcı yeni sekmeyi engelledi. Adres çubuğundaki açılır pencere iznini verip tekrar dene.",
        })
        toast.error("Yeni sekme açılamadı", {
          description: "Tarayıcı açılır pencereyi engelledi. İzin verip tekrar dene.",
        })
        log("error", "Yeni proje sekmesi açılamadı", "window.open engellendi")
        return
      }
      try {
        opened.opener = null
      } catch {
        /* aynı kaynak; opener'ı kapatmak zorunlu değil */
      }
    }

    const controller = new AbortController()
    activeController = controller
    set({
      busy: true,
      progress: 0,
      processing: false,
      fileName: file.name,
      fileSize: file.size,
      target,
    })
    log(
      "info",
      target === "new-tab"
        ? `Yeni proje için dosya yükleniyor: ${file.name}`
        : `Yerel dosya yükleniyor: ${file.name}`,
      target === "new-tab"
        ? `${formatBytes(file.size)} · mevcut proje korunuyor, yeni sekmede açılacak`
        : `${formatBytes(file.size)} · tarayıcı dosyanın yolunu vermediği için geçici kopya oluşturuluyor`,
    )

    let lastPercent = -1
    const showProgress = (ratio: number) => {
      const percent = Math.round(ratio * 100)
      if (percent === lastPercent) return
      lastPercent = percent
      toast.loading(
        target === "new-tab" ? `Yeni projeye aktarılıyor %${percent}` : `Yükleniyor %${percent}`,
        {
          id: IMPORT_TOAST_ID,
          description:
            `${formatBytes(file.size * ratio)} / ${formatBytes(file.size)} · ${file.name}` +
            (target === "new-tab" ? " · mevcut projen korunuyor" : ""),
          action: cancelAction(),
          duration: Infinity,
        },
      )
    }
    showProgress(0)

    try {
      const result = await api.uploadLocalFile(file, {
        signal: controller.signal,
        onProgress: (ratio) => {
          set({ progress: ratio })
          showProgress(ratio)
        },
        onUploaded: () => {
          set({ progress: 1, processing: true })
          toast.loading(
            target === "new-tab" ? "Yeni proje hazırlanıyor…" : "Tarayıcıya hazırlanıyor…",
            {
              id: IMPORT_TOAST_ID,
              description: `${formatBytes(file.size)} · ${file.name}`,
              action: cancelAction(),
              duration: Infinity,
            },
          )
        },
      })

      if (!result.success) {
        if (projectId) {
          writeProjectHandoff(projectId, {
            status: "cancelled",
            name: file.name,
            createdAt: Date.now(),
          })
        }
        log("warn", "Dosya hazırlığı iptal edildi.")
        toast.info(target === "new-tab" ? "Yeni proje iptal edildi" : "Dosya hazırlığı iptal edildi", {
          description: target === "new-tab" ? "Açılan sekme kapatılabilir." : undefined,
        })
        return
      }

      if (target === "new-tab" && projectId) {
        const wrote = writeProjectHandoff(projectId, {
          status: "ready",
          name: result.name,
          createdAt: Date.now(),
          result,
        })
        if (!wrote) {
          log("error", "Yeni proje sonucu aktarılamadı", "localStorage kullanılamıyor")
          toast.error("Yeni proje aktarılamadı", {
            description: "Dosya yüklendi ancak yeni sekmeye bilgi geçilemedi. Dosyayı yeniden içe aktar.",
          })
          return
        }
        log(
          "success",
          `Yeni proje hazır: ${result.name}`,
          `${result.width}×${result.height} · yeni sekmede açıldı`,
        )
        toast.success("Yeni proje açıldı", {
          description: `${result.name} · yeni sekmede`,
        })
      } else {
        applyLocalSource(result, null)
      }
    } catch (error) {
      if (isAbort(error)) {
        if (projectId) {
          writeProjectHandoff(projectId, {
            status: "cancelled",
            name: file.name,
            createdAt: Date.now(),
          })
        }
        log("warn", target === "new-tab" ? "Yeni proje yüklemesi iptal edildi." : "Dosya yüklemesi iptal edildi.")
        toast.info(target === "new-tab" ? "Yeni proje iptal edildi" : "Yükleme iptal edildi", {
          description: target === "new-tab" ? "Açılan sekme kapatılabilir." : undefined,
        })
      } else {
        const message = error instanceof Error ? error.message : String(error)
        if (projectId) {
          writeProjectHandoff(projectId, {
            status: "error",
            name: file.name,
            createdAt: Date.now(),
            error: message,
          })
        }
        log("error", target === "new-tab" ? "Yeni proje hazırlanamadı" : "Yerel dosya hazırlanamadı", message)
        toast.error(target === "new-tab" ? "Yeni proje hazırlanamadı" : "Dosya yüklenemedi", {
          description: message,
        })
      }
    } finally {
      toast.dismiss(IMPORT_TOAST_ID)
      if (activeController === controller) activeController = null
      set({
        busy: false,
        progress: null,
        processing: false,
        fileName: null,
        fileSize: null,
        target: null,
      })
    }
  }

  return {
    busy: false,
    picking: false,
    progress: null,
    processing: false,
    nativeUnavailable: false,
    fileName: null,
    fileSize: null,
    target: null,

    importFile: (file) => runImport(file, "current"),
    importFileInNewTab: (file) => runImport(file, "new-tab"),

    pickFile: async () => {
      if (get().picking || get().busy) return

      const controller = new AbortController()
      pickController = controller
      set({ picking: true })
      log("info", "Dosya seçim penceresi açılıyor (kopyasız)…")
      toast.loading("Dosya seçiliyor…", {
        id: PICK_TOAST_ID,
        description: "Pencere açık · işlem bitene kadar iptal edebilirsin",
        action: cancelAction(),
        duration: Infinity,
      })

      try {
        const result = await api.pickLocalFile(controller.signal)
        if (!result.success) {
          log("info", "Dosya seçimi iptal edildi.")
          return
        }
        applyLocalSource(result, result.path ?? result.name)
      } catch (error) {
        if (isAbort(error)) {
          log("warn", "Dosya seçimi iptal edildi.")
          toast.info("Dosya seçimi iptal edildi")
        } else if (error instanceof ApiError && error.status === 501) {
          set({ nativeUnavailable: true })
          log("warn", "Kopyasız dosya seçimi kullanılamıyor", error.message)
          toast.warning("Dosya penceresi açılamadı", {
            description:
              "Tarayıcıdan yükle seçeneğini kullanabilirsin (geçici kopya oluşturur).",
          })
        } else {
          const message = error instanceof Error ? error.message : String(error)
          log("error", "Dosya seçilemedi", message)
          toast.error("Dosya seçilemedi", { description: message })
        }
      } finally {
        toast.dismiss(PICK_TOAST_ID)
        if (pickController === controller) pickController = null
        set({ picking: false })
      }
    },

    cancel: () => {
      const state = get()
      if (!state.busy && !state.picking) return

      if (state.picking) pickController?.abort()
      if (state.busy) activeController?.abort()

      // Yükleme zaten bağlantıyı keser; dosya penceresi ve remux sunucuda ayrıca durdurulur.
      stopServerWork()
      log("info", "İşlem iptal ediliyor…")
    },
  }
})
