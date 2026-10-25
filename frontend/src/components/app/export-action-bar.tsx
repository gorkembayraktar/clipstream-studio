import { CircleCheckIcon, DownloadIcon, Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "cn"
import { useI18n } from "@/i18n"
import { compactDuration } from "@/lib/format"
import type { OutputFormat } from "@/lib/types"

import { FORMAT_LABELS } from "./export-panel-constants"

interface ExportActionBarProps {
  outputFormat: OutputFormat
  duration: number
  activeJobCount: number
  disabledReason: string | null
  pending: boolean
  started: boolean
  onExport: () => void
  onFocusJobs: () => void
}

export function ExportActionBar({
  outputFormat,
  duration,
  activeJobCount,
  disabledReason,
  pending,
  started,
  onExport,
  onFocusJobs,
}: ExportActionBarProps) {
  const { t } = useI18n()
  const durationLabel = compactDuration(Math.max(0, duration))
  const label = pending
    ? t("export.exporting")
    : started
      ? t("export.started")
      : activeJobCount > 0
        ? t("export.exportNew")
        : t("export.exportWithFormat", {
            format: FORMAT_LABELS[outputFormat],
            duration: durationLabel,
          })
  const disabled = pending || disabledReason !== null
  const reasonId = disabledReason ? "export-action-reason" : undefined

  return (
    <footer className="sticky bottom-0 z-10 rounded-b-xl border-t border-border/60 bg-card/95 px-3 pt-3 pb-3 backdrop-blur">
      {activeJobCount > 0 ? (
        <button
          type="button"
          onClick={onFocusJobs}
          className="mb-2 flex w-full cursor-pointer items-center gap-1.5 rounded-md py-0.5 text-left text-[10px] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          <DownloadIcon className="size-3" aria-hidden />
          {t("export.jobsLink", { count: activeJobCount })}
        </button>
      ) : null}

      {disabledReason ? (
        <p
          id="export-action-reason"
          className="mb-2 text-[10px] leading-snug text-amber-600 dark:text-amber-400"
        >
          {disabledReason}
        </p>
      ) : null}

      <Button
        type="button"
        className={cn(
          "h-10 w-full gap-2 text-xs font-semibold transition-all duration-200 active:scale-[0.98]",
          pending && "animate-pulse ring-2 ring-primary/30 disabled:opacity-100",
          started &&
            "bg-emerald-600 text-white shadow-lg shadow-emerald-500/25 ring-2 ring-emerald-500/30 hover:bg-emerald-600",
        )}
        onClick={onExport}
        disabled={disabled}
        aria-describedby={reasonId}
        aria-busy={pending}
      >
        {pending ? (
          <Loader2Icon className="animate-spin" aria-hidden />
        ) : started ? (
          <CircleCheckIcon
            className="animate-in zoom-in-95 duration-200"
            aria-hidden
          />
        ) : (
          <DownloadIcon aria-hidden />
        )}
        <span aria-live="polite">{label}</span>
      </Button>
    </footer>
  )
}
