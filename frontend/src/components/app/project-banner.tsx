/** Proje bulunamadığında veya yerel kayıt başarısız olduğunda gösterilen
 * engellemeyen bilgi şeridi. */
import { AlertTriangle, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ProjectNotice } from "@/hooks/use-project-workspace"
import { useI18n } from "@/i18n"

interface ProjectBannerProps {
  notice: ProjectNotice
  onDismiss: () => void
}

export function ProjectBanner({ notice, onDismiss }: ProjectBannerProps) {
  const { t } = useI18n()
  if (!notice) return null

  const missing = notice === "missing"
  const title = missing ? t("project.notFoundTitle") : t("project.storageTitle")
  const description = missing
    ? t("project.notFoundDescription")
    : t("project.storageDescription")

  return (
    <div
      className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-amber-900 dark:text-amber-200"
      role="status"
      aria-live="polite"
      data-slot="project-banner"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-xs font-semibold">{title}</p>
        <p className="text-[11px] leading-relaxed text-amber-900/80 dark:text-amber-200/80">
          {description}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        className="-mt-0.5 -mr-1 shrink-0 text-amber-900/70 hover:bg-amber-500/15 hover:text-amber-900 dark:text-amber-200/70 dark:hover:text-amber-100"
        onClick={onDismiss}
        title={t("project.dismiss")}
        aria-label={t("project.dismiss")}
      >
        <X />
      </Button>
    </div>
  )
}
