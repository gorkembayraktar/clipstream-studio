import { DownloadIcon, Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
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
  onExport: () => void
  onFocusJobs: () => void
}

export function ExportActionBar({
  outputFormat,
  duration,
  activeJobCount,
  disabledReason,
  pending,
  onExport,
  onFocusJobs,
}: ExportActionBarProps) {
  const { t } = useI18n()
  const durationLabel = compactDuration(Math.max(0, duration))
  const label = pending
    ? t("export.exporting")
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
        className="h-10 w-full gap-2 text-xs font-semibold"
        onClick={onExport}
        disabled={disabled}
        aria-describedby={reasonId}
        aria-busy={pending}
      >
        {pending ? (
          <Loader2Icon className="animate-spin" aria-hidden />
        ) : (
          <DownloadIcon aria-hidden />
        )}
        {label}
      </Button>
    </footer>
  )
}
