/** Galeri sekmesi: exports/ klasöründeki klipleri listeler, oynatır, indirir, siler. */
import { useState, type MouseEvent } from "react"

import {
  DownloadIcon,
  EllipsisVerticalIcon,
  FilmIcon,
  FolderOpenIcon,
  ImageIcon,
  MusicIcon,
  PlayIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"

import { GalleryPreviewDialog } from "@/components/app/gallery-preview-dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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

function FileIcon({ name, className }: { name: string; className?: string }) {
  const extension = name.split(".").pop()?.toLowerCase()
  if (extension === "mp3") return <MusicIcon className={className} />
  if (extension === "gif") return <ImageIcon className={className} />
  return <FilmIcon className={className} />
}

export function Gallery() {
  const { t } = useI18n()
  const { data, isLoading, isFetching, refetch } = useLibrary()
  const deleteFile = useDeleteLibraryFile()
  const reveal = useRevealInExplorer()
  const [previewFile, setPreviewFile] = useState<ExportFile | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const files = data?.files ?? []
  const isRefreshing = refreshing || isFetching

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
  const openPreview = (file: ExportFile) => {
    usePlayerStore.getState().pause()
    setPreviewFile(file)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {t("gallery.count", { count: files.length })}
        </p>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
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
                onPreview={() => openPreview(file)}
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
        onClose={() => setPreviewFile(null)}
        onReveal={(name) => reveal.mutate(name)}
      />
    </div>
  )
}

interface GalleryItemProps {
  file: ExportFile
  onPreview: () => void
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
    onPreview()
  }

  return (
    <li
      className="flex items-center gap-2 rounded-lg bg-muted/40 px-2 py-1.5"
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
        <Button variant="ghost" size="icon-xs" onClick={onPreview} title={t("gallery.preview")}>
          <PlayIcon />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
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

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("gallery.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("gallery.deleteDescription", { name: file.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("gallery.deleteCancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete}>
              {t("gallery.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}
