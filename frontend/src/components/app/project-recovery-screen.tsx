/** Proje kaynağı geri yüklenemediğinde gösterilen kurtarma ekranı. */
import { AlertCircle, FilePlus2, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useI18n } from "@/i18n"

interface ProjectRecoveryScreenProps {
  title: string | null
  error: string | null
  onRetry: () => void
  onStartFresh: () => void
}

export function ProjectRecoveryScreen({
  title,
  error,
  onRetry,
  onStartFresh,
}: ProjectRecoveryScreenProps) {
  const { t } = useI18n()

  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center overflow-y-auto px-4 py-6 text-foreground">
      <div
        className="w-full min-w-0 max-w-md space-y-5 rounded-2xl border bg-card p-6 text-center shadow-2xl sm:p-8"
        data-slot="project-recovery-screen"
      >
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertCircle className="size-6" />
        </div>

        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold">{t("project.sourceErrorTitle")}</h1>
          {title && (
            <p
              className="truncate text-sm font-medium text-foreground"
              title={title}
            >
              {title}
            </p>
          )}
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("project.sourceErrorDescription")}
          </p>
          {error && (
            <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-left text-xs leading-relaxed break-words text-destructive">
              {error}
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <Button className="w-full" onClick={onRetry} autoFocus>
            <RotateCcw />
            {t("project.retry")}
          </Button>
          <Button className="w-full" variant="outline" onClick={onStartFresh}>
            <FilePlus2 />
            {t("project.startFresh")}
          </Button>
        </div>
      </div>
    </div>
  )
}
