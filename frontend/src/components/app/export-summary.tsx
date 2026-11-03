import { useI18n } from "@/i18n"
import { compactDuration, formatTime } from "@/lib/format"
import type { OutputFormat } from "@/lib/types"

import {
  FORMAT_LABELS,
  PROFILE_LABEL_KEYS,
  type ExportProfile,
} from "./export-panel-constants"

interface ExportSummaryProps {
  start: number
  end: number
  duration: number
  outputFormat: OutputFormat
  profile: ExportProfile | null
  deviations: string[]
  /** Kaba çıktı boyutu tahmini (MB); hesaplanamıyorsa null. */
  estimatedSizeMb?: number | null
}

export function ExportSummary({
  start,
  end,
  duration,
  outputFormat,
  profile,
  deviations,
  estimatedSizeMb = null,
}: ExportSummaryProps) {
  const { t } = useI18n()

  return (
    <section className="rounded-t-xl border-b border-border/60 bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            {t("export.selection")}
          </h3>
          <p className="mt-1 truncate font-mono text-[13px] tabular-nums">
            {formatTime(start, true)}
            <span className="mx-1.5 text-muted-foreground">→</span>
            {formatTime(end, true)}
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-background px-2 py-1 font-mono text-[11px] tabular-nums text-muted-foreground ring-1 ring-border/60">
          {compactDuration(Math.max(0, duration))}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className="rounded bg-primary/10 px-1.5 py-0.5 font-semibold tracking-wide text-primary">
          {FORMAT_LABELS[outputFormat]}
        </span>
        {profile ? (
          <span className="rounded bg-background px-1.5 py-0.5 font-medium text-foreground ring-1 ring-border/60">
            {t(PROFILE_LABEL_KEYS[profile])}
          </span>
        ) : null}
        {deviations.map((deviation) => (
          <span
            key={deviation}
            className="rounded bg-background/70 px-1.5 py-0.5 text-muted-foreground ring-1 ring-border/40"
          >
            {deviation}
          </span>
        ))}
      </div>

      {estimatedSizeMb !== null ? (
        <p
          className="mt-2 text-[10px] leading-snug text-muted-foreground"
          title={t("export.estimateSizeHint")}
        >
          {t("export.estimateSize", {
            size: estimatedSizeMb.toFixed(1),
          })}
        </p>
      ) : null}
    </section>
  )
}
