/** Kalıcı proje çalışma alanları: şema, localStorage okuma/yazma ve doğrulama.
 *
 * Proje verisi yalnızca tarayıcıda tutulur. Sunucuya gönderilmez; curl
 * başlıkları gibi hassas bilgiler loglanmaz.
 */
import type {
  AspectPreset,
  CropRect,
  CutMode,
  ExportCodec,
  ExportQuality,
  OutputFormat,
  SourcePlatform,
  VideoMeta,
} from "@/lib/types"
import type { PanelTab } from "@/stores/project-ui-store"

export const PROJECT_SCHEMA_VERSION = 1
export const PROJECT_STORAGE_PREFIX = "clipstream.project."
/** Kullanıcı tarafından verilen proje adının üst sınırı. */
export const PROJECT_TITLE_MAX = 120

export interface ProjectSourceSnapshot {
  inputUrl: string
  originUrl: string | null
  streamUrl: string | null
  title: string | null
  resolution: string | null
  platform: SourcePlatform
  useProxy: boolean
  previewHeight: number | null
  audioTrackId: string | null
  subtitleTrackId: string | null
  headers: Record<string, string> | null
  headerToken: string | null
  sourcePath: string | null
  previewCopy: boolean
  isHls: boolean
  isLive: boolean
  meta: VideoMeta | null
  /** Kaynak açık bir proje akışı ise kimliği (yoksa null). */
  streamId?: string | null
  /** Kayda kaynaklık eden canlı yayın adresi (varsa). */
  liveUrl?: string | null
}

export interface ProjectSegment {
  start: number
  end: number
}

export interface ProjectEditSnapshot {
  trim: { start: number; end: number }
  /** Dışa aktarılacak parçalar; boşsa eski proje formatı (tek `trim`). */
  segments: ProjectSegment[]
  /** Kullanıcı bölme noktaları (makas); kaynak zamanında, kalıcı. */
  splits: number[]
  loop: boolean
  crop: { enabled: boolean; rect: CropRect | null; aspect: AspectPreset }
}

export interface ProjectExportSnapshot {
  cutMode: CutMode
  outputFormat: OutputFormat
  quality: ExportQuality
  codec: ExportCodec
  outputFps: number | null
  filename: string
  gpuEnabled: boolean
}

export interface ProjectTimelineSnapshot {
  zoom: number
  playhead: number
}

export interface ProjectUiSnapshot {
  panelTab: PanelTab
}

/** Proje çalışma alanı (kalıcı).
 *
 * Projenin tek "zaman çizelgesi" vardır: kayıtların biriktiği akış. Ayrı bir
 * dizi/çocuk görünüm durumu yoktur; akış kimliği `source.streamId` içindedir.
 */
export interface ProjectWorkspace {
  schemaVersion: number
  id: string
  /** Kullanıcının verdiği ad; boşsa kaynak başlığı gösterilir. */
  title: string | null
  created_date: number
  updated_date: number
  source: ProjectSourceSnapshot | null
  edit: ProjectEditSnapshot
  export: ProjectExportSnapshot
  timeline: ProjectTimelineSnapshot
  ui: ProjectUiSnapshot
}

/** URL'de ve localStorage anahtarında kullanılabilecek yeni kimlik üretir. */
export function createProjectId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function projectStorageKey(id: string): string {
  return `${PROJECT_STORAGE_PREFIX}${id}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function positiveNumberOr(value: unknown, fallback: number): number {
  const number = numberOr(value, fallback)
  return number > 0 ? number : fallback
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

/** Proje adı: kırpılır, boşsa null döner (kaynak başlığına düşülür). */
function parseTitle(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed.slice(0, PROJECT_TITLE_MAX) : null
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function parseHeaders(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  )
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

function parseMeta(value: unknown): VideoMeta | null {
  if (!isRecord(value)) return null
  const width = Math.max(0, numberOr(value.width, 0))
  const height = Math.max(0, numberOr(value.height, 0))
  const duration = Math.max(0, numberOr(value.duration, 0))
  const hasAudio = booleanOr(value.hasAudio, false)
  const fps = numberOr(value.fps, 0)
  if (width === 0 && height === 0 && duration === 0 && !hasAudio) return null
  return {
    width,
    height,
    duration,
    hasAudio,
    ...(fps > 0 ? { fps } : {}),
  }
}

function parseCropRect(value: unknown): CropRect | null {
  if (!isRecord(value)) return null
  const x = numberOr(value.x, NaN)
  const y = numberOr(value.y, NaN)
  const width = numberOr(value.width, NaN)
  const height = numberOr(value.height, NaN)
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null
  }
  return { x, y, width, height }
}

const SOURCE_PLATFORMS: readonly SourcePlatform[] = [
  "direct",
  "youtube",
  "twitter",
  "instagram",
  "tiktok",
  "ytdlp",
  "local",
]

function parsePlatform(value: unknown): SourcePlatform {
  return typeof value === "string" &&
    (SOURCE_PLATFORMS as readonly string[]).includes(value)
    ? (value as SourcePlatform)
    : "direct"
}

function parseSource(value: unknown): ProjectSourceSnapshot | null {
  if (!isRecord(value)) return null

  const inputUrl = typeof value.inputUrl === "string" ? value.inputUrl : ""
  const streamUrl = stringOrNull(value.streamUrl)
  if (!inputUrl && !streamUrl) return null

  return {
    inputUrl,
    originUrl: stringOrNull(value.originUrl),
    streamUrl,
    title: stringOrNull(value.title),
    resolution: stringOrNull(value.resolution),
    platform: parsePlatform(value.platform),
    useProxy: booleanOr(value.useProxy, false),
    previewHeight:
      typeof value.previewHeight === "number" && Number.isFinite(value.previewHeight)
        ? value.previewHeight
        : null,
    audioTrackId: stringOrNull(value.audioTrackId),
    subtitleTrackId: stringOrNull(value.subtitleTrackId),
    headers: parseHeaders(value.headers),
    headerToken: stringOrNull(value.headerToken),
    sourcePath: stringOrNull(value.sourcePath),
    previewCopy: booleanOr(value.previewCopy, false),
    isHls: booleanOr(value.isHls, false),
    isLive: booleanOr(value.isLive, false),
    meta: parseMeta(value.meta),
    streamId: stringOrNull(value.streamId),
    liveUrl: stringOrNull(value.liveUrl),
  }
}

const CUT_MODES: readonly CutMode[] = ["fast", "exact"]
const OUTPUT_FORMATS: readonly OutputFormat[] = ["mp4", "gif", "mp3"]
const QUALITIES: readonly ExportQuality[] = ["high", "balanced", "compact"]
const CODECS: readonly ExportCodec[] = ["h264", "hevc"]
const ASPECTS: readonly AspectPreset[] = ["free", "16:9", "9:16", "1:1", "4:5"]
const PANEL_TABS: readonly PanelTab[] = ["export", "gallery"]

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && (values as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

function parseEdit(value: unknown): ProjectEditSnapshot {
  const edit = isRecord(value) ? value : {}
  const trim = isRecord(edit.trim) ? edit.trim : {}
  const crop = isRecord(edit.crop) ? edit.crop : {}

  const trimRange = {
    start: Math.max(0, numberOr(trim.start, 0)),
    end: Math.max(0, numberOr(trim.end, 0)),
  }

  return {
    trim: trimRange,
    segments: parseSegments(edit.segments, trimRange),
    splits: parseSplits(edit.splits),
    loop: booleanOr(edit.loop, false),
    crop: {
      enabled: booleanOr(crop.enabled, false),
      rect: parseCropRect(crop.rect),
      aspect: oneOf(crop.aspect, ASPECTS, "free"),
    },
  }
}

/** Bölme noktaları: sonlu, pozitif, sıralı; bozuk kayıtlar sessizce atlanır. */
function parseSplits(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const points = value
    .filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    .map((item) => Math.max(0, item))
    .sort((a, b) => a - b)
  const result: number[] = []
  for (const point of points) {
    const last = result[result.length - 1]
    if (last === undefined || point - last > 0.05) result.push(point)
  }
  return result
}

/** Segment listesi yoksa (eski proje) `trim` tek segment olarak yorumlanır. */
function parseSegments(value: unknown, trim: { start: number; end: number }): ProjectSegment[] {
  if (!Array.isArray(value)) {
    return trim.end - trim.start > 0.0005 ? [{ ...trim }] : []
  }
  const segments = value
    .map((item) => {
      if (!isRecord(item)) return null
      return {
        start: Math.max(0, numberOr(item.start, 0)),
        end: Math.max(0, numberOr(item.end, 0)),
      }
    })
    .filter(
      (segment): segment is ProjectSegment =>
        segment !== null && segment.end - segment.start > 0.0005,
    )
    .sort((a, b) => a.start - b.start)
  if (segments.length > 0) return segments
  return trim.end - trim.start > 0.0005 ? [{ ...trim }] : []
}

function parseExport(value: unknown): ProjectExportSnapshot {
  const options = isRecord(value) ? value : {}
  const outputFps = options.outputFps
  return {
    cutMode: oneOf(options.cutMode, CUT_MODES, "exact"),
    outputFormat: oneOf(options.outputFormat, OUTPUT_FORMATS, "mp4"),
    quality: oneOf(options.quality, QUALITIES, "balanced"),
    codec: oneOf(options.codec, CODECS, "h264"),
    outputFps:
      typeof outputFps === "number" && Number.isFinite(outputFps) && outputFps > 0
        ? outputFps
        : null,
    filename: typeof options.filename === "string" ? options.filename : "",
    gpuEnabled: booleanOr(options.gpuEnabled, false),
  }
}

function parseTimeline(value: unknown): ProjectTimelineSnapshot {
  const timeline = isRecord(value) ? value : {}
  return {
    zoom: positiveNumberOr(timeline.zoom, 1),
    playhead: Math.max(0, numberOr(timeline.playhead, 0)),
  }
}

function parseUi(value: unknown): ProjectUiSnapshot {
  const ui = isRecord(value) ? value : {}
  return { panelTab: oneOf(ui.panelTab, PANEL_TABS, "export") }
}

function parseWorkspace(value: unknown, id: string): ProjectWorkspace | null {
  if (!isRecord(value)) return null
  if (value.schemaVersion !== PROJECT_SCHEMA_VERSION) return null
  if (typeof value.id !== "string" || value.id !== id) return null

  const created = numberOr(value.created_date, Date.now())
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id,
    title: parseTitle(value.title),
    created_date: created,
    updated_date: numberOr(value.updated_date, created),
    source: parseSource(value.source),
    edit: parseEdit(value.edit),
    export: parseExport(value.export),
    timeline: parseTimeline(value.timeline),
    ui: parseUi(value.ui),
  }
}

/** Kaydı okur; yoksa, bozuksa veya localStorage kullanılamıyorsa null döner. */
export function readProjectWorkspace(id: string): ProjectWorkspace | null {
  try {
    const raw = window.localStorage.getItem(projectStorageKey(id))
    if (!raw) return null
    return parseWorkspace(JSON.parse(raw), id)
  } catch {
    return null
  }
}

/** Kaydı yazar. Kota/gizli mod gibi hatalarda false döner, fırlatmaz. */
export function writeProjectWorkspace(project: ProjectWorkspace): boolean {
  try {
    window.localStorage.setItem(projectStorageKey(project.id), JSON.stringify(project))
    return true
  } catch {
    return false
  }
}

export function removeProjectWorkspace(id: string): void {
  try {
    window.localStorage.removeItem(projectStorageKey(id))
  } catch {
    /* localStorage kullanılamıyorsa yok sayılır */
  }
}

/** Bu tarayıcıda kayıtlı, kaynağı olan projeleri en son güncellenen önce olacak
 * biçimde döndürür. Bozuk kayıtlar sessizce atlanır. */
export function listProjectWorkspaces(): ProjectWorkspace[] {
  if (typeof window === "undefined") return []
  const projects: ProjectWorkspace[] = []
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key?.startsWith(PROJECT_STORAGE_PREFIX)) continue
      const id = key.slice(PROJECT_STORAGE_PREFIX.length)
      const record = readProjectWorkspace(id)
      if (record?.source) projects.push(record)
    }
  } catch {
    return []
  }
  return projects.sort((a, b) => b.updated_date - a.updated_date)
}
