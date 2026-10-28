/** Proje ayarları ve kaynağı geri yüklenirken gösterilen tam ekran durum. */
import { Clapperboard, Loader2 } from "lucide-react"

import { useI18n } from "@/i18n"

interface ProjectLoadingScreenProps {
  phase: "hydrating" | "restoring"
  title: string | null
  progress: number | null
  stage: string | null
  detail: string
}

export function ProjectLoadingScreen({
  phase,
  title,
  progress,
  stage,
  detail,
}: ProjectLoadingScreenProps) {
  const { t } = useI18n()
  const heading =
    phase === "hydrating"
      ? t("project.loadingSettings")
      : t("project.loadingSource")
  const stageLabel =
    phase === "restoring"
      ? stage === "downloading"
        ? t("source.downloadingTiktok")
        : stage === "transcoding"
          ? t("source.preparingBrowser")
          : t("source.resolving")
      : null
  const percent =
    progress === null ? null : Math.max(0, Math.min(100, Math.round(progress)))

  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center overflow-y-auto px-4 py-6 text-foreground">
      <div
        className="w-full min-w-0 max-w-md space-y-5 rounded-2xl border bg-card p-6 text-center shadow-2xl sm:p-8"
        role="status"
        aria-live="polite"
        aria-busy="true"
        data-slot="project-loading-screen"
      >
        <div className="relative mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Clapperboard className="size-6" />
          <Loader2 className="absolute -right-1 -bottom-1 size-5 animate-spin rounded-full bg-card p-0.5" />
        </div>

        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold">{heading}</h1>
          {title && (
            <p
              className="truncate text-sm font-medium text-foreground"
              title={title}
            >
              {title}
            </p>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            {phase === "hydrating"
              ? t("project.loadingSettingsDetail")
              : stageLabel || t("project.loadingSourceDetail")}
          </p>
          {phase === "restoring" && detail && (
            <p className="truncate text-[11px] text-muted-foreground/80" title={detail}>
              {detail}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <div
            className="relative mx-auto h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={heading}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
          >
            {percent === null ? (
              <div className="absolute inset-y-0 left-0 w-1/3 animate-[project-loading-bar_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
            ) : (
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: `${percent}%` }}
              />
            )}
          </div>

          <p
            className="h-3 font-mono text-[10px] tabular-nums text-muted-foreground"
            aria-hidden={percent === null}
          >
            {percent === null ? "\u00a0" : `${percent}%`}
          </p>
        </div>
      </div>
    </div>
  )
}
