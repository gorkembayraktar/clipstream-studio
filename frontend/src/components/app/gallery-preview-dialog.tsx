/** Galeri medya görüntüleyicisi: gezinme, metadata, eylemler ve hata durumları. */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react"

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  FilmIcon,
  FolderOpenIcon,
  ImageIcon,
  LoaderCircleIcon,
  MusicIcon,
  RotateCcwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

import { cn } from "cn"

import { DeleteFileDialog } from "@/components/app/delete-file-dialog"
import { FileIcon } from "@/components/app/file-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useDeleteLibraryFile, useLibraryFileMeta } from "@/hooks/use-library"
import { useI18n } from "@/i18n"
import { formatClock, formatFrameRate, formatMegabytes } from "@/lib/format"
import type { ExportFile, LibraryFileMeta } from "@/lib/types"

type PreviewKind = "video" | "audio" | "image" | "unsupported"

interface FormatInfo {
  kind: PreviewKind
  label: string
  mime: string | null
}

const FORMATS: Record<string, FormatInfo> = {
  mp4: { kind: "video", label: "MP4", mime: "video/mp4" },
  webm: { kind: "video", label: "WEBM", mime: "video/webm" },
  mkv: { kind: "video", label: "MKV", mime: "video/x-matroska" },
  gif: { kind: "image", label: "GIF", mime: "image/gif" },
  mp3: { kind: "audio", label: "MP3", mime: "audio/mpeg" },
}

const formatSupport = new Map<string, boolean>()

function formatInfo(name: string): FormatInfo {
  const extension = name.split(".").pop()?.toLowerCase() ?? ""
  return (
    FORMATS[extension] ?? {
      kind: "unsupported",
      label: extension ? extension.toUpperCase() : "FILE",
      mime: null,
    }
  )
}

/** Uzantıya değil, tarayıcının bildirdiği kap/codec desteğine de bak. */
function isFormatPlayable(format: FormatInfo): boolean {
  if (format.kind === "unsupported") return false
  if (format.kind === "image") return true
  if (!format.mime) return false

  const cached = formatSupport.get(format.mime)
  if (cached !== undefined) return cached
  if (typeof document === "undefined") return true

  const media = document.createElement(format.kind === "audio" ? "audio" : "video")
  const supported = media.canPlayType(format.mime) !== ""
  formatSupport.set(format.mime, supported)
  return supported
}

interface MediaMetadata {
  /** Hangi dosyadan geldiği: gezinmede eski değeri göstermemek için. */
  name: string
  width: number
  height: number
  duration: number
}

interface PreviewMediaProps {
  file: ExportFile
  format: FormatInfo
  onMetadata: (metadata: MediaMetadata) => void
  onError: () => void
}

function PreviewMedia({ file, format, onMetadata, onError }: PreviewMediaProps) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  // Modal kapanınca/dosya değişince oynatmayı durdur ve kaynağı bırak.
  useEffect(() => {
    const media = videoRef.current ?? audioRef.current
    return () => {
      if (!media) return
      media.pause()
      media.removeAttribute("src")
      media.load()
    }
  }, [])

  const handleVideoMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    const media = event.currentTarget
    onMetadata({
      name: file.name,
      width: media.videoWidth || 0,
      height: media.videoHeight || 0,
      duration: Number.isFinite(media.duration) ? media.duration : 0,
    })
  }

  const handleAudioMetadata = (event: SyntheticEvent<HTMLAudioElement>) => {
    const media = event.currentTarget
    onMetadata({
      name: file.name,
      width: 0,
      height: 0,
      duration: Number.isFinite(media.duration) ? media.duration : 0,
    })
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black">
      {format.kind === "video" ? (
        <video
          ref={videoRef}
          src={file.url}
          controls
          autoPlay
          playsInline
          className="max-h-full max-w-full object-contain"
          onLoadedMetadata={handleVideoMetadata}
          onLoadedData={() => setLoading(false)}
          onCanPlay={() => setLoading(false)}
          onError={() => {
            setLoading(false)
            onError()
          }}
        />
      ) : format.kind === "image" ? (
        <img
          src={file.url}
          alt={file.name}
          className="max-h-full max-w-full object-contain"
          onLoad={(event) => {
            setLoading(false)
            onMetadata({
              name: file.name,
              width: event.currentTarget.naturalWidth || 0,
              height: event.currentTarget.naturalHeight || 0,
              duration: 0,
            })
          }}
          onError={() => {
            setLoading(false)
            onError()
          }}
        />
      ) : (
        <div className="flex w-full max-w-xl flex-col items-center gap-4 px-6 py-8">
          <MusicIcon className="size-10 text-white/35" />
          <audio
            ref={audioRef}
            src={file.url}
            controls
            autoPlay
            className="w-full"
            onLoadedMetadata={handleAudioMetadata}
            onCanPlay={() => setLoading(false)}
            onError={() => {
              setLoading(false)
              onError()
            }}
          />
          <p className="text-xs text-white/45">{t("gallery.audioTrack")}</p>
        </div>
      )}

      {loading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
          <LoaderCircleIcon className="size-8 animate-spin text-white/60" />
          <span className="sr-only">{t("gallery.loading")}</span>
        </div>
      )}
    </div>
  )
}

interface PreviewFallbackProps {
  file: ExportFile
  format: FormatInfo
  mediaError: boolean
  onRetry: () => void
  onReveal: () => void
}

function PreviewFallback({
  file,
  format,
  mediaError,
  onRetry,
  onReveal,
}: PreviewFallbackProps) {
  const { t } = useI18n()
  const Icon =
    format.kind === "audio" ? MusicIcon : format.kind === "image" ? ImageIcon : FilmIcon

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-8 text-center">
      <Icon className="size-9 shrink-0 text-white/35" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-white/90">
          {mediaError ? t("gallery.previewFailed") : t("gallery.previewUnsupported")}
        </p>
        <p className="max-w-md text-xs text-white/55">
          {mediaError
            ? t("gallery.previewFailedHint")
            : t("gallery.previewUnsupportedHint")}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {mediaError && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RotateCcwIcon />
            {t("gallery.retry")}
          </Button>
        )}
        <Button variant="secondary" size="sm" asChild>
          <a href={file.url} download>
            <DownloadIcon />
            {t("gallery.download")}
          </a>
        </Button>
        <Button variant="secondary" size="sm" onClick={onReveal}>
          <FolderOpenIcon />
          {t("gallery.reveal")}
        </Button>
      </div>
    </div>
  )
}

interface PreviewFileListProps {
  files: ExportFile[]
  activeName: string
  variant: "sidebar" | "strip"
  onSelect: (name: string) => void
  onReveal: (name: string) => void
  onDeleteRequest: (name: string) => void
}

/** Modal içinden doğrudan dosya seçimi; aktif dosya görünür alanda tutulur. */
function PreviewFileList({
  files,
  activeName,
  variant,
  onSelect,
  onReveal,
  onDeleteRequest,
}: PreviewFileListProps) {
  const { t } = useI18n()
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [activeName])

  const list = (
    <ul
      aria-label={t("gallery.files")}
      className={variant === "strip" ? "flex w-max gap-1.5" : "space-y-0.5"}
    >
      {files.map((file) => {
        const active = file.name === activeName
        const selectButton = (
          <button
            ref={active ? activeRef : undefined}
            type="button"
            title={file.name}
            aria-current={active ? "true" : undefined}
            onClick={() => onSelect(file.name)}
            className={cn(
              "flex items-center rounded-md text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              variant === "sidebar"
                ? "min-w-0 flex-1 gap-2 px-2 py-1.5"
                : "max-w-56 shrink-0 gap-1.5 overflow-hidden border px-2 py-1.5",
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              variant === "strip" && !active && "border-border/50 bg-muted/30",
              variant === "strip" && active && "border-ring/60",
            )}
          >
            <FileIcon name={file.name} className="size-3.5 shrink-0" />
            <span
              className={cn(
                "min-w-0 truncate font-mono",
                variant === "sidebar" ? "flex-1 text-[11px]" : "text-[10px]",
                active && "font-medium",
              )}
            >
              {file.name}
            </span>
          </button>
        )

        return (
          <li key={file.name} className={variant === "strip" ? "shrink-0" : undefined}>
            {variant === "sidebar" ? (
              <div className="flex items-center gap-0.5">
                {selectButton}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="shrink-0 cursor-pointer"
                      title={t("gallery.actions")}
                      aria-label={t("gallery.actions")}
                    >
                      <EllipsisVerticalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem asChild>
                      <a href={file.url} download>
                        <DownloadIcon />
                        {t("gallery.download")}
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onReveal(file.name)}>
                      <FolderOpenIcon />
                      {t("gallery.reveal")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => onDeleteRequest(file.name)}
                    >
                      <Trash2Icon />
                      {t("gallery.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : (
              selectButton
            )}
          </li>
        )
      })}
    </ul>
  )

  return variant === "strip" ? (
    <div className="w-full overflow-x-auto pb-0.5">{list}</div>
  ) : (
    list
  )
}

interface MetadataPanelProps {
  file: ExportFile
  format: FormatInfo
  meta: LibraryFileMeta | undefined
  clientMeta: MediaMetadata | null
  fetching: boolean
  error: boolean
}

function MetadataPanel({
  file,
  format,
  meta,
  clientMeta,
  fetching,
  error,
}: MetadataPanelProps) {
  const { t } = useI18n()
  const width = meta?.width || clientMeta?.width || 0
  const height = meta?.height || clientMeta?.height || 0
  const duration =
    meta && meta.duration > 0 ? meta.duration : (clientMeta?.duration ?? 0)
  const fps = meta?.fps ?? 0
  const codec = meta?.codec?.trim() ?? ""
  const typeLabel =
    format.kind === "audio" ? `${format.label} · ${t("gallery.audioOnly")}` : format.label

  const rows: { label: string; value: string }[] = [
    { label: t("gallery.type"), value: typeLabel },
    { label: t("gallery.size"), value: formatMegabytes(file.size_mb) },
    { label: t("gallery.modified"), value: file.modified_str },
  ]

  if (width > 0 && height > 0) {
    rows.push({
      label: t("gallery.resolution"),
      value: `${width} × ${height}`,
    })
  }
  if (duration > 0) {
    rows.push({ label: t("gallery.duration"), value: formatClock(duration) })
  }
  if (fps > 0) {
    rows.push({ label: t("gallery.frameRate"), value: formatFrameRate(fps) })
  }
  if (codec && codec !== "unknown") {
    rows.push({ label: t("gallery.codec"), value: codec.toUpperCase() })
  }
  if (format.kind === "video" && typeof meta?.has_audio === "boolean") {
    rows.push({
      label: t("gallery.audio"),
      value: meta.has_audio ? t("gallery.audioYes") : t("gallery.audioNo"),
    })
  }

  return (
    <div className="min-w-0">
      <h3 className="mb-3 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        {t("gallery.details")}
      </h3>
      <dl className="space-y-2.5">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] items-start gap-2 text-xs"
          >
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="truncate font-medium" title={row.value}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {fetching && (
        <p className="mt-4 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <LoaderCircleIcon className="size-3 animate-spin" />
          {t("gallery.analyzing")}
        </p>
      )}
      {!fetching && error && (
        <p className="mt-4 text-[10px] text-muted-foreground">
          {t("gallery.metaUnavailable")}
        </p>
      )}
    </div>
  )
}

interface GalleryPreviewDialogProps {
  file: ExportFile | null
  files: ExportFile[]
  /** 1 tabanlı konum ve toplam dosya sayısı. */
  position: number
  total: number
  previousName: string | null
  nextName: string | null
  onNavigate: (name: string) => void
  onClose: () => void
  onDeleteSuccess: (fallbackName: string | null) => void
  onReveal: (name: string) => void
  onRestoreFocus: () => void
}

export function GalleryPreviewDialog({
  file,
  files,
  position,
  total,
  previousName,
  nextName,
  onNavigate,
  onClose,
  onDeleteSuccess,
  onReveal,
  onRestoreFocus,
}: GalleryPreviewDialogProps) {
  const { t } = useI18n()
  const [mediaErrorName, setMediaErrorName] = useState<string | null>(null)
  const [clientMeta, setClientMeta] = useState<MediaMetadata | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const metaQuery = useLibraryFileMeta(file)
  const deleteFile = useDeleteLibraryFile()

  const fileName = file?.name ?? ""
  const format = useMemo(() => formatInfo(fileName), [fileName])
  const playable = useMemo(() => isFormatPlayable(format), [format])
  const deleting = deleteFile.isPending && deleteFile.variables === fileName
  const deletePending =
    deleteTarget !== null &&
    deleteFile.isPending &&
    deleteFile.variables === deleteTarget
  const mediaError = mediaErrorName === fileName && Boolean(fileName)
  const activeClientMeta =
    clientMeta && clientMeta.name === fileName ? clientMeta : null

  const navigateTo = (name: string | null) => {
    if (!name || deleting) return
    setMediaErrorName(null)
    setAttempt(0)
    onNavigate(name)
  }
  const goPrevious = () => navigateTo(previousName)
  const goNext = () => navigateTo(nextName)

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
      return
    }
    const target = event.target
    if (
      target instanceof HTMLElement &&
      target.closest("input, textarea, select, video, audio, [contenteditable='true']")
    ) {
      return
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      goPrevious()
    } else if (event.key === "ArrowRight") {
      event.preventDefault()
      goNext()
    }
  }

  const handleDelete = () => {
    const target = deleteTarget
    if (!target) return

    const deletingCurrent = target === fileName
    // Açık klip silinirse sağdaki klibe, yoksa soldakine geç; tek dosya
    // kaldıysa modal kapanır. Diğer dosyalar silinirken görünüm korunur.
    const fallback = deletingCurrent ? (nextName ?? previousName) : fileName
    deleteFile.mutate(target, {
      onSuccess: () => {
        setDeleteTarget(null)
        if (!deletingCurrent) return
        setMediaErrorName(null)
        setAttempt(0)
        onDeleteSuccess(fallback)
      },
    })
  }

  const retry = () => {
    setMediaErrorName(null)
    setClientMeta(null)
    setAttempt((value) => value + 1)
  }

  return (
    <Dialog
      open={Boolean(file)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {file && (
        <DialogContent
          showCloseButton={false}
          onKeyDown={handleKeyDown}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            onRestoreFocus()
          }}
          className="grid h-[100dvh] w-full! max-w-none! grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0! overflow-hidden rounded-none! p-0! sm:h-[90dvh] sm:max-h-[52rem] sm:w-[90vw]! sm:max-w-6xl! sm:rounded-xl!"
        >
          <DialogHeader className="min-w-0 border-b px-4 py-3">
            <div className="flex min-w-0 items-start gap-2">
              <div className="min-w-0 flex-1">
                <DialogTitle
                  title={file.name}
                  className="truncate font-mono text-sm"
                >
                  {file.name}
                </DialogTitle>
                <DialogDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <Badge
                    variant="secondary"
                    className="h-5 px-1.5 font-mono text-[10px]"
                  >
                    {format.label}
                  </Badge>
                  <span>{formatMegabytes(file.size_mb)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{file.modified_str}</span>
                </DialogDescription>
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={!previousName || deleting}
                  onClick={goPrevious}
                  title={t("gallery.previous")}
                  aria-label={t("gallery.previous")}
                >
                  <ChevronLeftIcon />
                </Button>
                <span
                  className="min-w-12 text-center text-xs tabular-nums text-muted-foreground"
                  aria-live="polite"
                  aria-atomic="true"
                  aria-label={t("gallery.position", {
                    current: position,
                    total,
                  })}
                >
                  {position} / {total}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={!nextName || deleting}
                  onClick={goNext}
                  title={t("gallery.next")}
                  aria-label={t("gallery.next")}
                >
                  <ChevronRightIcon />
                </Button>
                <DialogClose asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t("common.close")}
                    aria-label={t("common.close")}
                  >
                    <XIcon />
                  </Button>
                </DialogClose>
              </div>
            </div>
          </DialogHeader>

          <div className="min-w-0 border-b px-4 py-2 lg:hidden">
            <div className="mb-1 flex items-center justify-between text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
              <span>{t("gallery.files")}</span>
              <span className="tabular-nums">{files.length}</span>
            </div>
            <PreviewFileList
              files={files}
              activeName={file.name}
              variant="strip"
              onSelect={navigateTo}
              onReveal={onReveal}
              onDeleteRequest={setDeleteTarget}
            />
          </div>

          <div className="min-h-0 overflow-x-hidden overflow-y-auto lg:overflow-hidden">
            <div className="flex min-h-full flex-col lg:h-full lg:min-h-0 lg:flex-row">
              <div className="relative flex h-[42dvh] min-h-56 shrink-0 items-center justify-center overflow-hidden bg-black lg:h-full lg:min-h-0 lg:flex-1">
                {mediaError || !playable ? (
                  <PreviewFallback
                    file={file}
                    format={format}
                    mediaError={mediaError}
                    onRetry={retry}
                    onReveal={() => onReveal(file.name)}
                  />
                ) : (
                  <PreviewMedia
                    key={`${file.name}:${attempt}`}
                    file={file}
                    format={format}
                    onMetadata={setClientMeta}
                    onError={() => setMediaErrorName(file.name)}
                  />
                )}
              </div>

              <aside className="min-w-0 shrink-0 border-t bg-muted/20 p-4 lg:flex lg:w-72 lg:flex-col lg:overflow-hidden lg:border-t-0 lg:border-l">
                <section
                  aria-label={t("gallery.files")}
                  className="hidden min-h-0 shrink-0 border-b pb-4 lg:block"
                >
                  <h3 className="mb-2 flex items-center justify-between text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                    <span>{t("gallery.files")}</span>
                    <span className="tabular-nums">{files.length}</span>
                  </h3>
                  <div className="max-h-44 overflow-y-auto pr-1">
                    <PreviewFileList
                      files={files}
                      activeName={file.name}
                      variant="sidebar"
                      onSelect={navigateTo}
                      onReveal={onReveal}
                      onDeleteRequest={setDeleteTarget}
                    />
                  </div>
                </section>

                <div className="min-h-0 lg:flex-1 lg:overflow-y-auto lg:pt-4">
                  <MetadataPanel
                    file={file}
                    format={format}
                    meta={metaQuery.data}
                    clientMeta={activeClientMeta}
                    fetching={metaQuery.isFetching}
                    error={metaQuery.isError}
                  />
                </div>
              </aside>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t bg-muted/50 px-4 py-3">
            <Button variant="outline" size="sm" asChild>
              <a href={file.url} download>
                <DownloadIcon />
                {t("gallery.download")}
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onReveal(file.name)}
            >
              <FolderOpenIcon />
              {t("gallery.reveal")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={() => setDeleteTarget(file.name)}
            >
              <Trash2Icon />
              {t("gallery.delete")}
            </Button>

            <div className="ml-auto flex items-center gap-3">
              <span className="hidden text-[10px] text-muted-foreground md:inline">
                {t("gallery.navigateHint")}
              </span>
              <DialogClose asChild>
                <Button size="sm">{t("common.close")}</Button>
              </DialogClose>
            </div>
          </div>

          <DeleteFileDialog
            open={deleteTarget !== null}
            fileName={deleteTarget ?? file.name}
            pending={deletePending}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null)
            }}
            onConfirm={handleDelete}
          />
        </DialogContent>
      )}
    </Dialog>
  )
}
