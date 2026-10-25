/** Galeri silme onayı: liste ve önizleme modalı aynı akışı kullanır. */
import { useRef } from "react"

import { LoaderCircleIcon, Trash2Icon } from "lucide-react"

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
import { useI18n } from "@/i18n"
import { formatBytes } from "@/lib/format"
import type { ExportFile } from "@/lib/types"

interface DeleteFileDialogProps {
  open: boolean
  fileName: string
  pending?: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function DeleteFileDialog({
  open,
  fileName,
  pending = false,
  onOpenChange,
  onConfirm,
}: DeleteFileDialogProps) {
  const { t } = useI18n()

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("gallery.deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("gallery.deleteDescription", { name: fileName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("gallery.deleteCancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            aria-busy={pending}
            onClick={onConfirm}
          >
            {pending ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <Trash2Icon />
            )}
            {t("gallery.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

interface DeleteFilesDialogProps {
  open: boolean
  files: ExportFile[]
  pending?: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

/** Toplu silme onayı: tek bir dialog içinde sayı, boyut ve dosya listesi. */
export function DeleteFilesDialog({
  open,
  files,
  pending = false,
  onOpenChange,
  onConfirm,
}: DeleteFilesDialogProps) {
  const { t } = useI18n()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const count = files.length
  const single = count === 1
  const totalBytes = files.reduce(
    (total, file) => total + file.size_mb * 1024 * 1024,
    0,
  )
  const size = formatBytes(totalBytes)
  const title = single
    ? t("gallery.deleteSelectedTitleOne")
    : t("gallery.deleteSelectedTitleMany")
  const description = single
    ? t("gallery.deleteSelectedDescriptionOne", { count, size })
    : t("gallery.deleteSelectedDescriptionMany", { count, size })
  const actionLabel = pending
    ? single
      ? t("gallery.deletingProgressOne")
      : t("gallery.deletingProgressMany", { count })
    : single
      ? t("gallery.deleteSelectedConfirmOne")
      : t("gallery.deleteSelectedConfirmMany", { count })

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        // İşlem sürerken Esc/overlay/Cancel dialogu kapatmasın.
        if (pending) return
        onOpenChange(nextOpen)
      }}
    >
      <AlertDialogContent
        className="max-w-[calc(100%-2rem)] sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          cancelRef.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          // Odağı Gallery yönetir; başarılı silmede hedef düğme değişebilir.
          event.preventDefault()
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <div
          tabIndex={0}
          aria-label={t("gallery.files")}
          className="max-h-40 overflow-y-auto rounded-lg border bg-muted/30 p-2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ul className="space-y-1">
            {files.map((file) => (
              <li
                key={file.name}
                title={file.name}
                className="truncate font-mono text-[11px]"
              >
                {file.name}
              </li>
            ))}
          </ul>
        </div>

        <span className="sr-only" role="status" aria-live="polite">
          {pending ? actionLabel : ""}
        </span>

        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={pending}>
            {t("gallery.deleteCancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            aria-busy={pending}
            onClick={(event) => {
              // Dialog.Close varsayılanını engelle: işlem bitene kadar açık kal.
              event.preventDefault()
              onConfirm()
            }}
          >
            {pending ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <Trash2Icon />
            )}
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
