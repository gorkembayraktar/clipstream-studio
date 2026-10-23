/** Galeri silme onayı: liste ve önizleme modalı aynı akışı kullanır. */
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
