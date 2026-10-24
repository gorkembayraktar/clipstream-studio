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
import { translate } from "@/i18n"
import { formatBytes, formatMegabytes, formatTime, stripExtension } from "@/lib/format"
import { writeProjectHandoff } from "@/lib/project-handoff"
import { projectHash } from "@/lib/project-route"
import type { LocalFileResponse } from "@/lib/types"
import { useExportStore } from "@/stores/export-store"
import { log } from "@/stores/log-store"
import { useSourceStore } from "@/stores/source-store"

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
    label: translate("common.cancel"),
    onClick: () => useLocalImportStore.getState().cancel(),
  }
}

/** Hazır kaynağı stüdyoya bağlar (her iki yol için ortak). */
function applyLocalSource(result: LocalFileResponse, sourcePath: string | null): void {
  const source = useSourceStore.getState()
  source.setUseProxy(false)
  source.setSource({
    streamUrl: result.url,
    title: result.name,
    resolution: result.width > 0 ? `${result.width}×${result.height}` : null,
    platform: "local",
    sourcePath,
    previewCopy: Boolean(result.remuxed),
    audioUrl: null,
    variants: [],
    isHls: false,
  })
  source.setMeta({
    width: result.width,
    height: result.height,
    duration: result.duration,
    hasAudio: result.has_audio,
    fps: result.fps > 0 ? result.fps : undefined,
  })

  const current = useExportStore.getState()
  if (!current.filename.trim()) current.setFilename(stripExtension(result.name))

  log(
    "success",
    translate("import.localReadyLog", { name: result.name }),
    `${result.width}×${result.height} · ${formatTime(result.duration)} · ${formatMegabytes(result.size_mb)}`,
  )
  if (result.remuxed) {
    log("info", translate("import.remuxed"))
  }
  toast.success(translate("import.fileReady"), {
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
      toast.info(translate("import.alreadyBusyTitle"), {
        description: translate("import.alreadyBusyDesc"),
      })
      return
    }

    if (!isSupportedVideo(file)) {
      toast.error(translate("import.notVideoTitle"), {
        description: translate("import.notVideoDesc"),
      })
      log("warn", translate("log.unsupportedFile", { name: file.name }))
      return
    }

    if (file.size === 0) {
      toast.error(translate("import.emptyTitle"), { description: file.name })
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
        toast.error(translate("import.newProjectFailedTitle"), {
          description: translate("import.newProjectFailedDesc"),
        })
        log(
          "error",
          translate("import.handoffWriteFailed"),
          translate("import.localStorageUnavailable"),
        )
        return
      }

      // Sekme, kullanıcı hareketi hâlâ geçerliyken açılmalı; yükleme sonrasına
      // bırakılırsa tarayıcı açılır pencereyi engelleyebilir.
      const projectUrl = new URL(window.location.href)
      projectUrl.search = ""
      projectUrl.hash = projectHash()
      projectUrl.searchParams.set("incoming", projectId)
      const opened = window.open(projectUrl.toString(), "_blank")
      if (!opened) {
        writeProjectHandoff(projectId, {
          status: "error",
          name: file.name,
          createdAt: Date.now(),
          error: translate("import.popupBlockedError"),
        })
        toast.error(translate("import.popupBlockedTitle"), {
          description: translate("import.popupBlockedDesc"),
        })
        log(
          "error",
          translate("import.newProjectTabFailed"),
          translate("import.windowOpenBlocked"),
        )
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
      translate(
        target === "new-tab" ? "import.uploadingForNew" : "import.uploadingLocal",
        { name: file.name },
      ),
      translate(
        target === "new-tab" ? "import.uploadingForNewExtra" : "import.uploadingLocalExtra",
        { size: formatBytes(file.size) },
      ),
    )

    let lastPercent = -1
    const showProgress = (ratio: number) => {
      const percent = Math.round(ratio * 100)
      if (percent === lastPercent) return
      lastPercent = percent
      toast.loading(
        translate(
          target === "new-tab" ? "import.progressNew" : "import.progressUpload",
          { percent },
        ),
        {
          id: IMPORT_TOAST_ID,
          description:
            translate("import.progressDesc", {
              current: formatBytes(file.size * ratio),
              total: formatBytes(file.size),
              name: file.name,
            }) + (target === "new-tab" ? translate("import.currentProtected") : ""),
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
            translate(
              target === "new-tab" ? "import.preparingNew" : "import.preparingBrowser",
            ),
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
        log("warn", translate("log.filePrepCancelled"))
        toast.info(
          translate(
            target === "new-tab" ? "import.newProjectCancelled" : "import.cancelledPrep",
          ),
          {
            description:
              target === "new-tab" ? translate("import.newTabClosable") : undefined,
          },
        )
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
          log(
            "error",
            translate("import.handoffReadFailed"),
            translate("import.localStorageUnavailable"),
          )
          toast.error(translate("import.transferFailedTitle"), {
            description: translate("import.transferFailedDesc"),
          })
          return
        }
        log(
          "success",
          translate("import.newProjectReadyLog", { name: result.name }),
          translate("import.newProjectReadyExtra", {
            size: `${result.width}×${result.height}`,
          }),
        )
        toast.success(translate("import.newProjectOpened"), {
          description: translate("import.newProjectOpenedDesc", { name: result.name }),
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
        log(
          "warn",
          translate(
            target === "new-tab"
              ? "import.uploadCancelledLog"
              : "import.localUploadCancelledLog",
          ),
        )
        toast.info(
          translate(
            target === "new-tab" ? "import.newProjectCancelled" : "import.uploadCancelledToast",
          ),
          {
            description:
              target === "new-tab" ? translate("import.newTabClosable") : undefined,
          },
        )
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
        log(
          "error",
          translate(
            target === "new-tab" ? "import.prepFailedLog" : "import.localPrepFailedLog",
          ),
          message,
        )
        toast.error(
          translate(
            target === "new-tab" ? "import.prepFailedToast" : "import.uploadFailedToast",
          ),
          {
            description: message,
          },
        )
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
      // Her denemede önce yerel (kopyasız) pencereyi dene. Önceki bir hata
      // yüzünden tarayıcı yüklemesine (geçici kopya) kilitlenmeyi önler.
      set({ picking: true, nativeUnavailable: false })
      log("info", translate("import.pickerOpening"))
      toast.loading(translate("import.pickerLoading"), {
        id: PICK_TOAST_ID,
        description: translate("import.pickerDesc"),
        action: cancelAction(),
        duration: Infinity,
      })

      try {
        const result = await api.pickLocalFile(controller.signal)
        if (!result.success) {
          log("info", translate("log.fileSelectionCancelled"))
          return
        }
        applyLocalSource(result, result.path ?? result.name)
      } catch (error) {
        if (isAbort(error)) {
          log("warn", translate("log.fileSelectionCancelled"))
          toast.info(translate("import.pickerCancelled"))
        } else if (error instanceof ApiError && error.status === 409) {
          // Zaten açık bir pencere var, sessizce bekle
          return
        } else if (error instanceof ApiError && error.status === 501) {
          set({ nativeUnavailable: true })
          log("warn", translate("log.nativeUnavailable"), error.message)
          toast.warning(translate("import.nativeUnavailableTitle"), {
            description: translate("import.nativeUnavailableDesc"),
          })
        } else {
          const message = error instanceof Error ? error.message : String(error)
          log("error", translate("import.pickFailedTitle"), message)
          toast.error(translate("import.pickFailedTitle"), { description: message })
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
      log("info", translate("log.cancelling"))
    },
  }
})
