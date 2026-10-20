/** Galeri sekmesi: exports/ klasöründeki klipleri listeler, oynatır, indirir, siler. */
import { useState } from "react"

import {
  DownloadIcon,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useDeleteLibraryFile,
  useLibrary,
  useRevealInExplorer,
} from "@/hooks/use-library"
import type { ExportFile } from "@/lib/types"
import { usePlayerStore } from "@/stores/player-store"

function FileIcon({ name, className }: { name: string; className?: string }) {
  const extension = name.split(".").pop()?.toLowerCase()
  if (extension === "mp3") return <MusicIcon className={className} />
  if (extension === "gif") return <ImageIcon className={className} />
  return <FilmIcon className={className} />
}

export function Gallery() {
  const { data, isLoading, isFetching, refetch } = useLibrary()
  const deleteFile = useDeleteLibraryFile()
  const reveal = useRevealInExplorer()
  const [previewFile, setPreviewFile] = useState<ExportFile | null>(null)
  const files = data?.files ?? []

  // Galeri önizlemesi açılırken ana oynatıcıyı durdur: iki sesin üst üste
  // çalmasını engeller. Kullanıcı modalı kapattığında oynatmayı kendisi sürdürür.
  const openPreview = (file: ExportFile) => {
    usePlayerStore.getState().pause()
    setPreviewFile(file)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{files.length} klip · exports/</p>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon-xs" onClick={() => void refetch()} title="Yenile">
            <RefreshCwIcon className={isFetching ? "animate-spin" : undefined} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => reveal.mutate(undefined)}
            title="Klasörü aç"
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
          Henüz klip yok. Dışa Aktar sekmesinden ilk klibini oluştur.
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
  return (
    <li className="flex items-center gap-2 rounded-lg bg-muted/40 px-2 py-1.5">
      <FileIcon name={file.name} className="size-4 shrink-0 text-muted-foreground" />

      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[11px]">{file.name}</p>
        <p className="text-[10px] text-muted-foreground">
          {file.size_mb} MB · {file.modified_str}
        </p>
      </div>

      <div className="flex shrink-0 items-center">
        <Button variant="ghost" size="icon-xs" onClick={onPreview} title="Oynat">
          <PlayIcon />
        </Button>
        <Button variant="ghost" size="icon-xs" asChild title="İndir">
          <a href={file.url} download>
            <DownloadIcon />
          </a>
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={onReveal} title="Klasörde göster">
          <FolderOpenIcon />
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-destructive hover:text-destructive"
              title="Sil"
              disabled={deleting}
            >
              <Trash2Icon />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Dosya silinsin mi?</AlertDialogTitle>
              <AlertDialogDescription>
                <span className="break-all font-mono text-xs">{file.name}</span> kalıcı
                olarak silinecek. Bu işlem geri alınamaz.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Vazgeç</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onDelete}>
                Sil
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  )
}
