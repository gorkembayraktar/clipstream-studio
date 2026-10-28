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
  PROJECT_TITLE_MAX,
  type ProjectEditSnapshot,
  type ProjectSourceSnapshot,
  type ProjectTimelineSnapshot,
  type ProjectWorkspace,
} from "@/lib/project-workspace"
import type { StreamSummary } from "@/lib/types"
import { useEditStore } from "@/stores/edit-store"
import { useExportStore } from "@/stores/export-store"
import { log } from "@/stores/log-store"
import { usePlayerStore } from "@/stores/player-store"
import { useProjectStore } from "@/stores/project-store"
import { toPanelTab, useProjectUiStore } from "@/stores/project-ui-store"
import { useRecorderStore } from "@/stores/recorder-store"
import { useSourceStore } from "@/stores/source-store"
import { useStreamStore } from "@/stores/stream-store"
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
  /** Proje adını değiştirir; boş ad kaynak başlığına döner. */
  rename: (title: string) => void
  retry: () => void
  startFresh: () => void
  /** Projeden ana sayfaya döner; proje kaydı ve kayıtlar korunur. */
  goHome: () => void
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
  useProjectUiStore.getState().setPanelTab(toPanelTab(record.ui.panelTab))

  const editStore = useEditStore.getState()
  editStore.setLoop(record.edit.loop)
  editStore.setCropAspect(record.edit.crop.aspect)
  editStore.setCropRect(record.edit.crop.rect)
  editStore.setCropEnabled(record.edit.crop.enabled)
}

/** Kaynak + düzenleme + oynatma konumu taşıyan en küçük görünüm.
 *
 * Hem tam proje kaydı hem de dizi görünümünden dönüşte saklanan ana görünüm
 * bu biçime uyar; geri yükleme yardımcıları ikisini de kabul eder.
 */
type ProjectView = {
  source: ProjectSourceSnapshot | null
  edit: ProjectEditSnapshot
  timeline: ProjectTimelineSnapshot
}

function applySourceSelections(view: { source: ProjectSourceSnapshot | null }): void {
  const snapshot = view.source
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

function applyEditSnapshot(view: { edit: ProjectEditSnapshot }): void {
  const snapshot = view.edit
  const editStore = useEditStore.getState()
  editStore.setLoop(snapshot.loop)
  editStore.setCropAspect(snapshot.crop.aspect)
  editStore.setCropRect(snapshot.crop.rect)
  editStore.setCropEnabled(snapshot.crop.enabled)
  // Trim, kaynağın süresi bilindiğinde (setMeta sonrası) sınırlandırılır.
  if (snapshot.segments.length > 0) {
    editStore.setSegments(snapshot.segments)
  }
  // Makasla konan bölme noktaları segmentlerden sonra geri yüklenir.
  if (snapshot.splits.length > 0) {
    editStore.setSplits(snapshot.splits)
  }
  // In/Out seçimi segmentlerden bağımsızdır: her durumda geri yüklenir.
  if (snapshot.trim.end - snapshot.trim.start > 0) {
    editStore.setTrim(snapshot.trim)
  }
}

function requestRestoredPlayhead(view: { timeline: ProjectTimelineSnapshot }): void {
  const player = usePlayerStore.getState()
  if (view.timeline.playhead > 0.05) {
    player.mark({ currentTime: view.timeline.playhead })
    player.requestSeek(view.timeline.playhead)
  } else {
    player.clearPendingSeek()
  }
}

function restoreLocalSource(view: ProjectView): boolean {
  const snapshot = view.source
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

  applySourceSelections(view)
  applyEditSnapshot(view)
  requestRestoredPlayhead(view)
  return true
}

async function restoreRemoteSource(
  view: ProjectView,
  options: {
    signal: AbortSignal
    onProgress: (event: ResolveProgressEvent) => void
  },
): Promise<void> {
  const snapshot = view.source
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

  applySourceSelections(view)
  applyEditSnapshot(view)
  requestRestoredPlayhead(view)
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
  useProjectUiStore.getState().setPanelTab("export")

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
  streamId?: string | null
}): string | null {
  // Akış kaynağının adresi her kayıtta değişir (sürüm sorgusu); kimlik akışa
  // bağlı kalır ki proje bölünmesin ve kayıtlar doğru projeye yazılsın.
  if (source.streamId) return `stream:${source.streamId}`
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
    streamId: snapshot.streamId,
  })
}

/** Kaynak store'undan kalıcı kaynak anlık görüntüsü. */
function sourceSnapshotOf(
  source: ReturnType<typeof useSourceStore.getState>,
): ProjectSourceSnapshot | null {
  if (!source.streamUrl) return null
  return {
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
    streamId: source.streamId,
    liveUrl: source.liveUrl,
  }
}

/** Düzenleme store'undan kalıcı kesim anlık görüntüsü. */
function editSnapshotOf(
  edit: ReturnType<typeof useEditStore.getState>,
): ProjectEditSnapshot {
  return {
    trim: { ...edit.trim },
    segments: edit.segments.map((segment) => ({
      start: segment.start,
      end: segment.end,
    })),
    splits: [...edit.splits],
    loop: edit.loop,
    crop: {
      enabled: edit.crop.enabled,
      rect: edit.crop.rect ? { ...edit.crop.rect } : null,
      aspect: edit.crop.aspect,
    },
  }
}

/** Zaman çizelgesi store'undan yakınlaştırma + imleç anlık görüntüsü. */
function timelineSnapshotOf(
  timeline: ReturnType<typeof useTimelineStore.getState>,
  playhead: number,
): ProjectTimelineSnapshot {
  return { zoom: timeline.zoom, playhead }
}

/** Store'lardan tam proje kaydı üretir (kayıt = tek doğru kaynak). */
function snapshotFromStores(
  projectId: string,
  createdDate: number,
  title: string | null,
): ProjectWorkspace {
  const source = useSourceStore.getState()
  const exportStore = useExportStore.getState()
  const timeline = useTimelineStore.getState()
  const player = usePlayerStore.getState()
  const ui = useProjectUiStore.getState()

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: projectId,
    title,
    created_date: createdDate,
    updated_date: Date.now(),
    source: sourceSnapshotOf(source),
    edit: editSnapshotOf(useEditStore.getState()),
    export: {
      cutMode: exportStore.cutMode,
      outputFormat: exportStore.outputFormat,
      quality: exportStore.quality,
      codec: exportStore.codec,
      outputFps: exportStore.outputFps,
      filename: exportStore.filename,
      gpuEnabled: exportStore.gpuEnabled,
    },
    timeline: timelineSnapshotOf(timeline, player.pendingSeek ?? player.currentTime),
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
  /** Kullanıcının verdiği ad; anlık görüntülere buradan yazılır. */
  const projectTitleRef = useRef<string | null>(null)
  const createdDateRef = useRef<number | null>(null)
  /** Mevcut proje kaydının kaynak kimliği; farklı kaynakta yeni ID üretilir. */
  const projectSourceRef = useRef<string | null>(null)
  const storageFailedRef = useRef(false)
  const sourceKey = useSourceStore((s) => sourceIdentity(s))

  const buildSnapshot = useCallback(
    (id: string, createdDate: number) =>
      snapshotFromStores(id, createdDate, projectTitleRef.current),
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
      projectTitleRef.current = null

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
      useProjectStore.getState().setProjectId(record.id)
      projectTitleRef.current = record.title
      setTitle(record.title ?? record.source?.title ?? null)
      applyProjectSettings(record)

      await waitForMinimum()
      if (cancelled) return

      if (record.source) {
        setPhase("restoring")
        setProgress(0)
        setStage("resolving")
        try {
          // Akış kimliği = proje kimliğidir: önce projenin kendi akışı denenir.
          // Eski/bozuk snapshot başka bir akışı gösteriyorsa (ya da akışı hiç
          // bilmiyorsa) bu, kayıtların yeni/boş bir projeye kaymasını önler.
          const streamIds = [record.id]
          if (record.source.streamId && record.source.streamId !== record.id) {
            streamIds.push(record.source.streamId)
          }
          let summary: StreamSummary | null = null
          for (const candidate of streamIds) {
            summary = await useStreamStore.getState().load(candidate)
            if (summary) break
          }

          if (summary) {
            // Proje akışı: kayıtların biriktiği tek timeline. Canlı adres
            // yeniden çözülmez; yalnızca kayıt başlatılırken (gerekirse) çözülür.
            const source = useSourceStore.getState()
            source.setInputUrl(record.source.inputUrl || record.source.liveUrl || "")
            source.setLiveUrl(record.source.liveUrl ?? null)
            source.setStreamSource(summary)
            applySourceSelections(record)
            applyEditSnapshot(record)
            requestRestoredPlayhead(record)
          } else if (record.source.platform === "local") {
            if (!restoreLocalSource(record)) {
              throw new Error(translate("project.sourceMissing"))
            }
          } else {
            // Akış diskte yok (temizlik): canlı kaynağa düş, kayıt yeniden
            // başlatılabilir. Proje kimliği korunur.
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
      // Akış kaynağı kurulurken timeline yakınlaştırması sıfırlanmış olabilir.
      useTimelineStore.getState().setZoom(record.timeline.zoom)
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

    // Akış kimliği = proje kimliği: kayıt bitince kaynak "canlı yayın"dan
    // proje akışına döner. Bu, aynı projenin devamıdır (yeni kimlik üretilmez).
    // Farklı bir akış kimliği görünse bile yeni proje **açılmaz**: yeni proje,
    // az önce kaydedilen blokları boş bir projeye taşımak demektir.
    if (sourceKey.startsWith("stream:")) {
      projectSourceRef.current = sourceKey
      if (sourceKey !== `stream:${projectIdRef.current}`) {
        log(
          "warn",
          translate("project.streamMismatchLog"),
          `${sourceKey} ≠ ${projectIdRef.current ?? "-"}`,
        )
      }
      return
    }

    // Proje değişiyor: önceki projede süren kayıt kapatılır. Segmentler zaten
    // akışa yazıldığı için veri kaybı yok; eski proje geçmişte durur.
    const previousProject = projectIdRef.current
    if (previousProject && useRecorderStore.getState().recordings.length > 0) {
      void useRecorderStore.getState().stopForProject(previousProject)
    }

    const id = createProjectId()
    const createdDate = Date.now()
    // Önceki projenin akış özeti yeni projeye sızmasın: akış kimliği proje
    // kimliğidir, yeni projede akış ancak ilk kayıtla doğar.
    useStreamStore.getState().reset()
    // Yeni proje yeni bir addır: önceki projenin adı taşınmaz.
    projectTitleRef.current = null
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
    useProjectStore.getState().setProjectId(id)
    setTitle(null)
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
    projectTitleRef.current = null
    setProjectId(null)
    useProjectStore.getState().setProjectId(null)
    setPhase("ready")
    setProgress(null)
    setStage(null)
    setDetail("")
    setError(null)
    setNotice(null)
    setTitle(null)
  }, [])

  const dismissNotice = useCallback(() => setNotice(null), [])

  /** Proje adını değiştirir ve hemen diske yazar (gecikmeli kaydı beklemez). */
  const rename = useCallback(
    (next: string) => {
      const normalized = next.trim().slice(0, PROJECT_TITLE_MAX)
      const value = normalized.length > 0 ? normalized : null
      projectTitleRef.current = value
      setTitle(value)

      // Geri yükleme sürerken store'lar henüz dolmamış olabilir; bu durumda
      // hemen yazmak kaynağı siler. Kayıt hazır olunca gecikmeli kayıt zaten
      // yeni adı yazar.
      if (phase !== "ready") return

      const id = projectIdRef.current
      const createdDate = createdDateRef.current
      if (!id || createdDate === null || storageFailedRef.current) return

      if (!writeProjectWorkspace(buildSnapshot(id, createdDate))) {
        storageFailedRef.current = true
        setNotice("storage")
        log("error", translate("project.storageFailedLog"))
      }
    },
    [buildSnapshot, phase],
  )

  /** Ana sayfaya dön: proje geçmişte kalır, sahne temizlenir. */
  const goHome = useCallback(() => {
    const id = projectIdRef.current
    const createdDate = createdDateRef.current
    // Son düzenlemeler (ve oynatma konumu) kaybolmasın: hemen yazılır.
    if (id && createdDate && !storageFailedRef.current) {
      writeProjectWorkspace(buildSnapshot(id, createdDate))
    }
    // Süren kayıt varsa proje akışına yazılsın (veri kaybı yok).
    if (id) void useRecorderStore.getState().stopForProject(id)

    useStreamStore.getState().reset()
    resetStudioState()

    projectIdRef.current = null
    projectSourceRef.current = null
    createdDateRef.current = null
    storageFailedRef.current = false
    projectTitleRef.current = null
    clearProjectFromUrl()

    setProjectId(null)
    useProjectStore.getState().setProjectId(null)
    setPhase("ready")
    setProgress(null)
    setStage(null)
    setDetail("")
    setError(null)
    setNotice(null)
    setTitle(null)
  }, [buildSnapshot])

  return {
    phase,
    projectId,
    title,
    progress,
    stage,
    detail,
    error,
    notice,
    rename,
    retry,
    startFresh,
    goHome,
    dismissNotice,
  }
}
