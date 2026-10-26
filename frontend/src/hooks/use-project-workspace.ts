/** Proje çalışma alanı yaşam döngüsü: URL'den geri yükleme, kaynak yeniden
 * çözümleme, localStorage kalıcılığı ve yeni proje başlatma.
 *
 * Ayarlar önce uygulanır, kaynak sonra yüklenir. Kaynak çözümlenirken tam
 * ekran yükleme durumu gösterilir; böylece boş varsayılan arayüz görünmez.
 */
import { useCallback, useEffect, useRef, useState } from "react"

import { translate } from "@/i18n"
import { api, type ResolveProgressEvent } from "@/lib/api"
import {
  clearProjectFromUrl,
  isProjectId,
  projectParamFromUrl,
  setProjectInUrl,
} from "@/lib/project-route"
import {
  createProjectId,
  readProjectWorkspace,
  removeProjectWorkspace,
  writeProjectWorkspace,
  PROJECT_SCHEMA_VERSION,
  type ProjectWorkspace,
} from "@/lib/project-workspace"
import { useEditStore } from "@/stores/edit-store"
import { useExportStore } from "@/stores/export-store"
import { log } from "@/stores/log-store"
import { usePlayerStore } from "@/stores/player-store"
import { useProjectUiStore } from "@/stores/project-ui-store"
import { useSourceStore } from "@/stores/source-store"
import { useTimelineStore } from "@/stores/timeline-store"

/** Ayarların uygulandığı görülsün diye kısa bir alt sınır. */
const MIN_LOADING_MS = 400
/** Oynatma sırasında timeupdate her ~250 ms'de bir gelir; yazmayı sınırla. */
const PERSIST_THROTTLE_MS = 800

export type ProjectPhase = "hydrating" | "restoring" | "ready" | "error"
export type ProjectNotice = "missing" | "storage" | null

export interface ProjectWorkspaceController {
  phase: ProjectPhase
  projectId: string | null
  title: string | null
  progress: number | null
  stage: string | null
  detail: string
  error: string | null
  notice: ProjectNotice
  retry: () => void
  startFresh: () => void
  dismissNotice: () => void
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function applyProjectSettings(record: ProjectWorkspace): void {
  const exportStore = useExportStore.getState()
  exportStore.setCutMode(record.export.cutMode)
  exportStore.setOutputFormat(record.export.outputFormat)
  exportStore.setQuality(record.export.quality)
  exportStore.setCodec(record.export.codec)
  exportStore.setOutputFps(record.export.outputFps)
  exportStore.setFilename(record.export.filename)
  exportStore.setGpuEnabled(record.export.gpuEnabled)

  useTimelineStore.getState().setZoom(record.timeline.zoom)
  useProjectUiStore.getState().setPanelTab(record.ui.panelTab)

  const editStore = useEditStore.getState()
  editStore.setLoop(record.edit.loop)
  editStore.setCropAspect(record.edit.crop.aspect)
  editStore.setCropRect(record.edit.crop.rect)
  editStore.setCropEnabled(record.edit.crop.enabled)
}

function applySourceSelections(record: ProjectWorkspace): void {
  const snapshot = record.source
  if (!snapshot) return

  const source = useSourceStore.getState()
  if (snapshot.previewHeight !== null) {
    const exists = source.variants.some(
      (variant) =>
        (variant.quality_height ?? variant.height) === snapshot.previewHeight,
    )
    if (exists) source.setPreviewHeight(snapshot.previewHeight)
  }
  if (snapshot.audioTrackId) source.setAudioTrackId(snapshot.audioTrackId)
  if (snapshot.subtitleTrackId) source.setSubtitleTrackId(snapshot.subtitleTrackId)
}

function applyEditSnapshot(record: ProjectWorkspace): void {
  const editStore = useEditStore.getState()
  editStore.setLoop(record.edit.loop)
  editStore.setCropAspect(record.edit.crop.aspect)
  editStore.setCropRect(record.edit.crop.rect)
  editStore.setCropEnabled(record.edit.crop.enabled)
  // Trim, kaynağın süresi bilindiğinde (setMeta sonrası) sınırlandırılır.
  if (record.edit.segments.length > 0) {
    editStore.setSegments(record.edit.segments)
  } else {
    editStore.setTrim(record.edit.trim)
  }
}

function requestRestoredPlayhead(record: ProjectWorkspace): void {
  const player = usePlayerStore.getState()
  if (record.timeline.playhead > 0.05) {
    player.mark({ currentTime: record.timeline.playhead })
    player.requestSeek(record.timeline.playhead)
  } else {
    player.clearPendingSeek()
  }
}

function restoreLocalSource(record: ProjectWorkspace): boolean {
  const snapshot = record.source
  if (!snapshot?.streamUrl) return false

  const source = useSourceStore.getState()
  source.setUseProxy(snapshot.useProxy)
  source.setInputUrl(snapshot.inputUrl)
  source.setSource({
    streamUrl: snapshot.streamUrl,
    title: snapshot.title,
    resolution: snapshot.resolution,
    platform: snapshot.platform,
    originUrl: snapshot.originUrl ?? snapshot.inputUrl,
    audioUrl: null,
    audioTracks: [],
    subtitleTracks: [],
    variants: [],
    isHls: snapshot.isHls,
    isLive: snapshot.isLive,
    sourcePath: snapshot.sourcePath,
    previewCopy: snapshot.previewCopy,
    headers: snapshot.headers,
    headerToken: snapshot.headerToken,
  })
  if (snapshot.meta) source.setMeta(snapshot.meta)

  applySourceSelections(record)
  applyEditSnapshot(record)
  requestRestoredPlayhead(record)
  return true
}

async function restoreRemoteSource(
  record: ProjectWorkspace,
  options: {
    signal: AbortSignal
    onProgress: (event: ResolveProgressEvent) => void
  },
): Promise<void> {
  const snapshot = record.source
  if (!snapshot) return

  const url = snapshot.originUrl || snapshot.inputUrl
  if (!url) throw new Error(translate("project.sourceMissing"))

  const headers = snapshot.headers
  const resolved = await api.resolveStream(url, headers, {
    onProgress: options.onProgress,
    signal: options.signal,
  })

  const platform =
    resolved.platform ?? (resolved.is_youtube ? "youtube" : "direct")
  const effectiveHeaders = platform === "direct" ? headers : null
  const source = useSourceStore.getState()

  source.setUseProxy(
    platform !== "direct" && platform !== "local"
      ? true
      : Boolean(effectiveHeaders) || snapshot.useProxy,
  )
  source.setInputUrl(url)
  source.setSource({
    streamUrl: resolved.stream_url,
    title: resolved.title ?? snapshot.title,
    resolution: resolved.resolution ?? snapshot.resolution,
    platform,
    originUrl: url,
    audioUrl: resolved.audio_url ?? null,
    audioTracks: resolved.audio_tracks ?? [],
    subtitleTracks: resolved.subtitle_tracks ?? [],
    variants: resolved.variants ?? [],
    isHls: Boolean(
      resolved.is_m3u8 || resolved.variants?.some((variant) => variant.hls),
    ),
    isLive: Boolean(resolved.is_live),
    headers: effectiveHeaders,
    headerToken: resolved.header_token ?? null,
  })
  if (snapshot.meta) source.setMeta(snapshot.meta)

  applySourceSelections(record)
  applyEditSnapshot(record)
  requestRestoredPlayhead(record)
}

function resetStudioState(): void {
  const player = usePlayerStore.getState()
  player.pause()
  player.clearPendingSeek()
  player.noteStatus(null)
  player.mark({
    playing: false,
    buffering: false,
    currentTime: 0,
    duration: 0,
    bufferedEnd: 0,
    pipActive: false,
    videoWidth: 0,
    videoHeight: 0,
  })

  const source = useSourceStore.getState()
  source.clearSource()
  source.setInputUrl("")
  source.setUseProxy(false)

  useEditStore.getState().resetEdit()
  useTimelineStore.getState().resetZoom()
  useProjectUiStore.getState().setPanelTab("source")

  const exportStore = useExportStore.getState()
  exportStore.setCutMode("exact")
  exportStore.setOutputFormat("mp4")
  exportStore.setQuality("balanced")
  exportStore.setCodec("h264")
  exportStore.setOutputFps(null)
  exportStore.setFilename("")
  exportStore.setGpuEnabled(false)
}

/** Aynı kaynağı (varyant/parça değişimleri hariç) kararlı biçimde tanımlar. */
function sourceIdentity(source: {
  streamUrl: string | null
  platform: string
  sourceOrigin?: string | null
  inputUrl: string
  sourcePath?: string | null
}): string | null {
  if (!source.streamUrl) return null
  if (source.platform === "local") {
    return `local:${source.sourcePath ?? source.streamUrl}`
  }
  return `remote:${source.sourceOrigin || source.inputUrl || source.streamUrl}`
}

function snapshotSourceIdentity(
  snapshot: ProjectWorkspace["source"],
): string | null {
  if (!snapshot) return null
  return sourceIdentity({
    streamUrl: snapshot.streamUrl,
    platform: snapshot.platform,
    sourceOrigin: snapshot.originUrl,
    inputUrl: snapshot.inputUrl,
    sourcePath: snapshot.sourcePath,
  })
}

function snapshotFromStores(
  projectId: string,
  createdDate: number,
): ProjectWorkspace {
  const source = useSourceStore.getState()
  const edit = useEditStore.getState()
  const exportStore = useExportStore.getState()
  const timeline = useTimelineStore.getState()
  const player = usePlayerStore.getState()
  const ui = useProjectUiStore.getState()

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: projectId,
    created_date: createdDate,
    updated_date: Date.now(),
    source: source.streamUrl
      ? {
          inputUrl: source.inputUrl,
          originUrl: source.sourceOrigin,
          streamUrl: source.streamUrl,
          title: source.title,
          resolution: source.resolution,
          platform: source.platform,
          useProxy: source.useProxy,
          previewHeight: source.previewHeight,
          audioTrackId: source.audioTrackId,
          subtitleTrackId: source.subtitleTrackId,
          headers: source.headers ? { ...source.headers } : null,
          headerToken: source.headerToken,
          sourcePath: source.sourcePath,
          previewCopy: source.previewCopy,
          isHls: source.isHls,
          isLive: source.isLive,
          meta: source.meta ? { ...source.meta } : null,
        }
      : null,
    edit: {
      trim: { ...edit.trim },
      segments: edit.segments.map((segment) => ({
        start: segment.start,
        end: segment.end,
      })),
      loop: edit.loop,
      crop: {
        enabled: edit.crop.enabled,
        rect: edit.crop.rect ? { ...edit.crop.rect } : null,
        aspect: edit.crop.aspect,
      },
    },
    export: {
      cutMode: exportStore.cutMode,
      outputFormat: exportStore.outputFormat,
      quality: exportStore.quality,
      codec: exportStore.codec,
      outputFps: exportStore.outputFps,
      filename: exportStore.filename,
      gpuEnabled: exportStore.gpuEnabled,
    },
    timeline: {
      zoom: timeline.zoom,
      // Henüz video elementine uygulanmamış geri yükleme konumu kaybolmasın.
      playhead: player.pendingSeek ?? player.currentTime,
    },
    ui: { panelTab: ui.panelTab },
  }
}

export function useProjectWorkspace(): ProjectWorkspaceController {
  const [initialParam] = useState<string | null>(() => projectParamFromUrl())
  const initialId = isProjectId(initialParam) ? initialParam : null

  const [projectId, setProjectId] = useState<string | null>(initialId)
  const [phase, setPhase] = useState<ProjectPhase>(
    initialParam ? "hydrating" : "ready",
  )
  const [title, setTitle] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [stage, setStage] = useState<string | null>(null)
  const [detail, setDetail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<ProjectNotice>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  const projectIdRef = useRef<string | null>(initialId)
  const createdDateRef = useRef<number | null>(null)
  /** Mevcut proje kaydının kaynak kimliği; farklı kaynakta yeni ID üretilir. */
  const projectSourceRef = useRef<string | null>(null)
  const storageFailedRef = useRef(false)
  const sourceKey = useSourceStore((s) => sourceIdentity(s))

  const buildSnapshot = useCallback(
    (id: string, createdDate: number) => snapshotFromStores(id, createdDate),
    [],
  )

  // URL'de proje varsa ayarları oku, ardından kaynağı otomatik yükle.
  useEffect(() => {
    const raw = initialParam
    if (!raw) {
      setPhase("ready")
      return
    }

    let cancelled = false
    const controller = new AbortController()
    const startedAt = performance.now()

    const waitForMinimum = async () => {
      const remaining = MIN_LOADING_MS - (performance.now() - startedAt)
      if (remaining > 0) await delay(remaining)
    }

    const showMissing = async () => {
      clearProjectFromUrl()
      await waitForMinimum()
      if (cancelled) return
      projectIdRef.current = null
      projectSourceRef.current = null
      setProjectId(null)
      setPhase("ready")
      setNotice("missing")
      log("warn", translate("project.notFoundLog"))
    }

    const run = async () => {
      setError(null)
      setNotice(null)
      setPhase("hydrating")
      setProgress(null)
      setStage(null)
      setDetail("")
      setTitle(null)

      if (!isProjectId(raw)) {
        await showMissing()
        return
      }

      const record = readProjectWorkspace(raw)
      if (!record) {
        await showMissing()
        return
      }

      createdDateRef.current = record.created_date
      projectIdRef.current = record.id
      projectSourceRef.current = snapshotSourceIdentity(record.source)
      setProjectId(record.id)
      setTitle(record.source?.title ?? null)
      applyProjectSettings(record)

      await waitForMinimum()
      if (cancelled) return

      if (record.source) {
        setPhase("restoring")
        setProgress(0)
        setStage("resolving")
        try {
          if (record.source.platform === "local") {
            if (!restoreLocalSource(record)) {
              throw new Error(translate("project.sourceMissing"))
            }
          } else {
            await restoreRemoteSource(record, {
              signal: controller.signal,
              onProgress: (event) => {
                if (cancelled) return
                if (event.percent !== undefined) {
                  setProgress((previous) =>
                    Math.max(previous ?? 0, event.percent ?? 0),
                  )
                }
                if (event.stage) setStage(event.stage)
                if (event.detail !== undefined) setDetail(event.detail)
              },
            })
          }
        } catch (restoreError) {
          if (cancelled || controller.signal.aborted || isAbort(restoreError)) {
            return
          }
          const message = errorMessage(restoreError)
          setError(message)
          setPhase("error")
          log("error", translate("project.sourceRestoreFailedLog"), message)
          return
        }
      }

      if (cancelled) return
      setProgress(100)
      setPhase("ready")
      log(
        "success",
        translate("project.restoredLog", {
          title: record.source?.title ?? record.id,
        }),
      )
    }

    void run()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [initialParam, retryNonce])

  // Kaynak yüklendiğinde ya da farklı bir kaynağa geçildiğinde yeni proje
  // kimliği üret. Aynı kaynak yeniden yüklenirse mevcut kimlik korunur.
  useEffect(() => {
    if (phase !== "ready" || !sourceKey) return
    if (storageFailedRef.current) return
    if (projectSourceRef.current === sourceKey) return

    const id = createProjectId()
    const createdDate = Date.now()
    const snapshot = buildSnapshot(id, createdDate)

    if (!writeProjectWorkspace(snapshot)) {
      storageFailedRef.current = true
      setNotice("storage")
      log("error", translate("project.storageFailedLog"))
      return
    }

    createdDateRef.current = createdDate
    projectIdRef.current = id
    projectSourceRef.current = sourceKey
    setProjectId(id)
    setNotice(null)
    setProjectInUrl(id)
    log(
      "success",
      translate("project.createdLog", {
        title: useSourceStore.getState().title ?? id,
      }),
    )
  }, [phase, sourceKey, buildSnapshot])

  // Proje hazır olduğunda ilgili store'ları izle ve değişiklikleri gecikmeli yaz.
  useEffect(() => {
    if (phase !== "ready" || !projectId) return

    const createdDate = createdDateRef.current ?? Date.now()
    createdDateRef.current = createdDate
    let timer: number | undefined
    let storageWarningShown = false

    const flush = () => {
      // Yeni proje başlatıldıysa eski kimlik adına kayıt yeniden oluşturulmasın.
      if (projectIdRef.current !== projectId) return
      const snapshot = buildSnapshot(projectId, createdDate)
      if (writeProjectWorkspace(snapshot)) return
      storageFailedRef.current = true
      if (!storageWarningShown) {
        storageWarningShown = true
        setNotice("storage")
        log("error", translate("project.storageFailedLog"))
      }
    }

    const schedule = () => {
      if (timer !== undefined) return
      timer = window.setTimeout(() => {
        timer = undefined
        flush()
      }, PERSIST_THROTTLE_MS)
    }

    const unsubscribe = [
      useSourceStore.subscribe(schedule),
      useEditStore.subscribe(schedule),
      useExportStore.subscribe(schedule),
      useTimelineStore.subscribe(schedule),
      usePlayerStore.subscribe(schedule),
      useProjectUiStore.subscribe(schedule),
    ]

    const flushNow = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer)
        timer = undefined
      }
      flush()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushNow()
    }

    flush()
    window.addEventListener("beforeunload", flushNow)
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      unsubscribe.forEach((removeListener) => removeListener())
      window.removeEventListener("beforeunload", flushNow)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [phase, projectId, buildSnapshot])

  const retry = useCallback(() => {
    setError(null)
    setRetryNonce((value) => value + 1)
  }, [])

  const startFresh = useCallback(() => {
    const id = projectIdRef.current
    projectIdRef.current = null
    projectSourceRef.current = null
    if (id) removeProjectWorkspace(id)
    clearProjectFromUrl()
    resetStudioState()

    createdDateRef.current = null
    storageFailedRef.current = false
    setProjectId(null)
    setPhase("ready")
    setProgress(null)
    setStage(null)
    setDetail("")
    setError(null)
    setNotice(null)
    setTitle(null)
  }, [])

  const dismissNotice = useCallback(() => setNotice(null), [])

  return {
    phase,
    projectId,
    title,
    progress,
    stage,
    detail,
    error,
    notice,
    retry,
    startFresh,
    dismissNotice,
  }
}
