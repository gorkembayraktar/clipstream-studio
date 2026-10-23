/** Galeri sekmesi: exports/ klasöründeki klipleri listeler, oynatır, indirir, siler. */
import { useRef, useState, type MouseEvent } from "react"

import {
  DownloadIcon,
  EllipsisVerticalIcon,
  FolderOpenIcon,
  PlayIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"

import { DeleteFileDialog } from "@/components/app/delete-file-dialog"
import { FileIcon } from "@/components/app/file-icon"
import { GalleryPreviewDialog } from "@/components/app/gallery-preview-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useDeleteLibraryFile,
  useLibrary,
  useRevealInExplorer,
} from "@/hooks/use-library"
import { useI18n } from "@/i18n"
import { formatMegabytes } from "@/lib/format"
import type { ExportFile } from "@/lib/types"
import { usePlayerStore } from "@/stores/player-store"

export function Gallery() {
  const { t } = useI18n()
  const { data, isLoading, isFetching, refetch } = useLibrary()
  const deleteFile = useDeleteLibraryFile()
  const reveal = useRevealInExplorer()
  const [previewName, setPreviewName] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const refreshButtonRef = useRef<HTMLButtonElement>(null)
  const previewTriggerRef = useRef<HTMLElement | null>(null)
  const files = data?.files ?? []
  const isRefreshing = refreshing || isFetching

  // Seçim dosya adıyla tutulur: yenileme/silme sonrası nesne referansı
  // eskise bile sıra güncel listeden yeniden hesaplanır.
  const previewIndex = previewName
    ? files.findIndex((file) => file.name === previewName)
    : -1
  const previewFile = previewIndex >= 0 ? files[previewIndex] : null
  const previousName = previewIndex > 0 ? files[previewIndex - 1].name : null
  const nextName =
    previewIndex >= 0 && previewIndex < files.length - 1
      ? files[previewIndex + 1].name
      : null

  const handleRefresh = async () => {
    setRefreshing(true)
    const started = performance.now()
    try {
      await refetch()
    } finally {
      // Kısa süren yenilemelerde animasyon anında kaybolmasın.
      const remaining = 500 - (performance.now() - started)
      if (remaining > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remaining))
      }
      setRefreshing(false)
    }
  }

  // Galeri önizlemesi açılırken ana oynatıcıyı durdur: iki sesin üst üste
  // çalmasını engeller. Kullanıcı modalı kapattığında oynatmayı kendisi sürdürür.
  const openPreview = (file: ExportFile, trigger: HTMLElement) => {
    usePlayerStore.getState().pause()
    previewTriggerRef.current = trigger
    setPreviewName(file.name)
  }

  /** Modal kapanınca açan satıra/düğmeye, o artık yoksa yenile düğmesine dön. */
  const restorePreviewFocus = () => {
    const trigger = previewTriggerRef.current
    if (trigger?.isConnected) {
      trigger.focus({ preventScroll: true })
      return
    }
    refreshButtonRef.current?.focus({ preventScroll: true })
  }

  const closePreview = () => {
    setPreviewName(null)
    // Radix içerik hemen söküldüğünde odak body'ye düşebiliyor; bir kare
    // sonra odağı açan öğeye geri ver.
    window.requestAnimationFrame(() => restorePreviewFocus())
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {t("gallery.count", { count: files.length })}
        </p>
        <div className="flex items-center gap-0.5">
          <Button
            ref={refreshButtonRef}
            variant="ghost"
            size="icon-xs"
            className="cursor-pointer"
            onClick={() => void handleRefresh()}
            title={t("gallery.refresh")}
            aria-busy={isRefreshing}
            disabled={isRefreshing}
          >
            <RefreshCwIcon className={isRefreshing ? "animate-spin" : undefined} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="cursor-pointer"
            onClick={() => reveal.mutate(undefined)}
            title={t("gallery.openFolder")}
          >
            <FolderOpenIcon />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-13 w-full" />
          ))}
        </div>
      ) : files.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          {t("gallery.empty")}
        </p>
      ) : (
        <ScrollArea className="h-[360px]">
          <ul className="space-y-1.5 pr-2">
            {files.map((file) => (
              <GalleryItem
                key={file.name}
                file={file}
                onPreview={(trigger) => openPreview(file, trigger)}
                onDelete={() => deleteFile.mutate(file.name)}
                onReveal={() => reveal.mutate(file.name)}
                deleting={deleteFile.isPending && deleteFile.variables === file.name}
              />
            ))}
          </ul>
        </ScrollArea>
      )}

      <GalleryPreviewDialog
        file={previewFile}
        files={files}
        position={previewIndex + 1}
        total={files.length}
        previousName={previousName}
        nextName={nextName}
        onNavigate={setPreviewName}
        onClose={closePreview}
        onDeleteSuccess={(name) => {
          if (name) setPreviewName(name)
          else closePreview()
        }}
        onReveal={(name) => reveal.mutate(name)}
        onRestoreFocus={restorePreviewFocus}
      />
    </div>
  )
}

interface GalleryItemProps {
  file: ExportFile
  onPreview: (trigger: HTMLElement) => void
  onDelete: () => void
  onReveal: () => void
  deleting: boolean
}

function GalleryItem({ file, onPreview, onDelete, onReveal, deleting }: GalleryItemProps) {
  const { t } = useI18n()
  const [deleteOpen, setDeleteOpen] = useState(false)

  /** Satıra çift tıklama, düğmelere dokunmadan klibi önizlemede açar. */
  const handleDoubleClick = (event: MouseEvent<HTMLLIElement>) => {
    if ((event.target as HTMLElement).closest("button, a")) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    onPreview(event.currentTarget)
  }

  return (
    <li
      tabIndex={-1}
      className="group flex cursor-pointer items-center gap-2 rounded-lg bg-muted/40 px-2 py-1.5 ring-1 ring-transparent transition-all duration-150 outline-none hover:bg-muted/70 hover:shadow-sm hover:ring-border/60 focus-visible:ring-2 focus-visible:ring-ring active:bg-muted/80"
      onDoubleClick={handleDoubleClick}
    >
      <FileIcon name={file.name} className="size-4 shrink-0 text-muted-foreground" />

      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[11px]">{file.name}</p>
        <p className="text-[10px] text-muted-foreground">
          {formatMegabytes(file.size_mb)} · {file.modified_str}
        </p>
      </div>

      <div className="flex shrink-0 items-center">
        <Button
          variant="ghost"
          size="icon-xs"
          className="cursor-pointer"
          onClick={(event) => onPreview(event.currentTarget)}
          title={t("gallery.preview")}
        >
          <PlayIcon />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="cursor-pointer"
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
            <DropdownMenuItem onSelect={onReveal}>
              <FolderOpenIcon />
              {t("gallery.reveal")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={deleting}
              onSelect={() => setDeleteOpen(true)}
            >
              <Trash2Icon />
              {t("gallery.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <DeleteFileDialog
        open={deleteOpen}
        fileName={file.name}
        pending={deleting}
        onOpenChange={setDeleteOpen}
        onConfirm={onDelete}
      />
    </li>
  )
}
