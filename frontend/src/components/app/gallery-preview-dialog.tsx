/** Galeri klibi önizleme modalı: videoyu, GIF'i veya MP3'ü yerinde oynatır. */
import { useState } from "react"

import { DownloadIcon, FilmIcon, FolderOpenIcon, MusicIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ExportFile } from "@/lib/types"

type PreviewKind = "video" | "audio" | "image" | "other"

function extensionOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? ""
}

function previewKind(name: string): PreviewKind {
  const extension = extensionOf(name)
  if (["mp3", "wav", "m4a", "aac", "ogg"].includes(extension)) return "audio"
  if (["gif", "png", "jpg", "jpeg", "webp", "avif"].includes(extension)) return "image"
  if (["mp4", "webm", "mkv", "mov", "m4v"].includes(extension)) return "video"
  return "other"
}

function PreviewMedia({ file }: { file: ExportFile }) {
  const [mediaError, setMediaError] = useState(false)
  const kind = previewKind(file.name)
  const previewable = kind !== "other"

  return (
    <div className="bg-black">
      {!previewable || mediaError ? (
        <div className="flex min-h-56 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          {kind === "audio" ? (
            <MusicIcon className="size-9 text-white/35" />
          ) : (
            <FilmIcon className="size-9 text-white/35" />
          )}
          <div className="space-y-1">
            <p className="text-sm text-white/85">
              {mediaError ? "Dosya oynatılamadı." : "Bu dosya tarayıcıda önizlenemiyor."}
            </p>
            <p className="max-w-md text-xs text-white/55">
              {mediaError
                ? "Dosya taşınmış veya tarayıcı bu codec'i desteklemiyor olabilir. İndirip harici bir oynatıcıda açabilirsin."
                : "İndirip harici bir oynatıcıda açabilirsin."}
            </p>
          </div>
        </div>
      ) : kind === "video" ? (
        <video
          src={file.url}
          controls
          autoPlay
          playsInline
          className="max-h-[70vh] w-full bg-black object-contain"
          onError={() => setMediaError(true)}
        />
      ) : kind === "image" ? (
        <img
          src={file.url}
          alt={file.name}
          className="max-h-[70vh] w-full bg-black object-contain"
          onError={() => setMediaError(true)}
        />
      ) : (
        <div className="flex flex-col items-center gap-4 px-6 py-10">
          <MusicIcon className="size-10 text-white/35" />
          <audio
            src={file.url}
            controls
            autoPlay
            className="w-full max-w-xl"
            onError={() => setMediaError(true)}
          />
          <p className="text-xs text-white/45">Ses kaydı</p>
        </div>
      )}
    </div>
  )
}

interface GalleryPreviewDialogProps {
  file: ExportFile | null
  onClose: () => void
  onReveal: (name: string) => void
}

export function GalleryPreviewDialog({ file, onClose, onReveal }: GalleryPreviewDialogProps) {
  return (
    <Dialog
      open={Boolean(file)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {file && (
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-4xl">
          <DialogHeader className="border-b px-4 py-3 pr-12">
            <DialogTitle className="truncate font-mono text-sm">{file.name}</DialogTitle>
            <DialogDescription>
              {file.size_mb} MB · {file.modified_str}
            </DialogDescription>
          </DialogHeader>

          <PreviewMedia key={file.url} file={file} />

          <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/50 px-4 py-3">
            <Button variant="outline" size="sm" asChild>
              <a href={file.url} download>
                <DownloadIcon />
                İndir
              </a>
            </Button>
            <Button variant="outline" size="sm" onClick={() => onReveal(file.name)}>
              <FolderOpenIcon />
              Klasörde göster
            </Button>
            <Button size="sm" onClick={onClose}>
              Kapat
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}
