/** Dışa aktarma işinin canlı ilerlemesi ve sonuç kartı (paralel işler için çoklanır). */
import { useEffect, useRef, useState, type ReactNode } from "react"

import { useQueryClient } from "@tanstack/react-query"
import {
  BanIcon,
  CircleCheckIcon,
  ClockIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  FolderOpenIcon,
  Loader2Icon,
  PlayIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import { ExportThumbnail } from "@/components/app/export-thumbnail"
import { JobPreviewDialog } from "@/components/app/job-preview-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { useCancelJob, useJob } from "@/hooks/use-export-job"
import { useExportTitle } from "@/hooks/use-export-title"
import { libraryKeys, useRevealInExplorer } from "@/hooks/use-library"
import { translate, useI18n } from "@/i18n"
import { formatTime, formatMegabytes, formatRemaining } from "@/lib/format"
import type { JobStatus } from "@/lib/types"
import { log } from "@/stores/log-store"
import { usePlayerStore } from "@/stores/player-store"
import { cn } from "cn"

const FORMAT_LABELS: Record<string, string> = { mp4: "MP4", gif: "GIF", mp3: "MP3" }

/** Bildirimler kart kapatılıp yeniden açılsa da iş başına yalnızca bir kez gösterilir. */
const notifiedStates = new Set<string>()

function JobCard({
  status,
  queued = false,
  children,
  thumbnail,
}: {
  status: JobStatus
  queued?: boolean
  children: ReactNode
  thumbnail?: { name: string; version?: string | number }
}) {
  const active = status === "pending" || status === "running"

  return (
    <div
      data-slot="job-card"
      data-status={status}
      className={cn(
        "overflow-hidden rounded-xl border",
        active && "border-border/70 bg-background/40",
        status === "done" && "border-emerald-500/25 bg-emerald-500/[0.03]",
        status === "error" && "border-destructive/30 bg-destructive/[0.04]",
        status === "cancelled" && "border-border/60 bg-background/40 opacity-80",
      )}
    >
      <div className="flex gap-2.5 p-2.5">
        {status === "done" && thumbnail ? (
          <span
            aria-hidden="true"
            className="relative mt-0.5 h-9 w-14 shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-emerald-500/20"
          >
            <ExportThumbnail
              name={thumbnail.name}
              version={thumbnail.version}
              className="size-full"
              iconClassName="size-3.5"
            />
            <span className="absolute right-0.5 bottom-0.5 grid size-3.5 place-items-center rounded-full bg-emerald-500 text-white ring-1 ring-card">
              <CircleCheckIcon className="size-2.5" />
            </span>
          </span>
        ) : (
          <span
            className={cn(
              "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full",
              active && "bg-primary/10 text-primary",
              status === "done" &&
                "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
              status === "error" && "bg-destructive/10 text-destructive",
              status === "cancelled" && "bg-muted text-muted-foreground",
            )}
          >
            {active && !queued && (
              <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
            )}
            {active && queued && <ClockIcon className="size-3.5" aria-hidden />}
            {status === "done" && <CircleCheckIcon className="size-3.5" aria-hidden />}
            {status === "error" && <TriangleAlertIcon className="size-3.5" aria-hidden />}
            {status === "cancelled" && <BanIcon className="size-3.5" aria-hidden />}
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-2">{children}</div>
      </div>
    </div>
  )
}

export function JobProgress({ jobId }: { jobId: string }) {
  const { t } = useI18n()
  const { data: job } = useJob(jobId)
  const cancelJob = useCancelJob(jobId)
  const reveal = useRevealInExplorer()
  const queryClient = useQueryClient()
  const playButtonRef = useRef<HTMLButtonElement>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  useExportTitle(jobId, job?.status, job?.progress)

  // Durum geçişlerinde tek seferlik bildirim + galeri tazeleme
  useEffect(() => {
    if (!job?.status) return
    const key = `${job.id}:${job.status}`
    if (notifiedStates.has(key)) return
    notifiedStates.add(key)

    if (job.status === "done") {
      log(
        "success",
        translate("job.doneLog", {
          name: job.output_filename ?? "",
          size: job.size_mb === undefined ? "—" : formatMegabytes(job.size_mb),
          seconds: job.elapsed_sec ?? 0,
        }),
      )
      toast.success(translate("job.ready"), { description: job.output_filename })
    } else if (job.status === "error") {
      log("error", translate("job.failedLog"), job.error?.slice(0, 300))
      toast.error(translate("job.failedLog"), { description: job.error?.slice(0, 140) })
    } else if (job.status === "cancelled") {
      log("warn", translate("log.exportCancelled"))
    }
    if (job.status === "done" || job.status === "error") {
      void queryClient.invalidateQueries({ queryKey: libraryKeys.all })
    }
  }, [job, queryClient])

  if (!job) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/40 p-2.5 text-xs text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" />
        {t("job.preparing")}
      </div>
    )
  }

  const canCancel = job.status === "pending" || job.status === "running"
  const queued = job.status === "pending" && (job.queue_position ?? 0) > 0
  const range =
    job.clip_start != null && job.clip_end != null
      ? `${formatTime(job.clip_start, true)} → ${formatTime(job.clip_end, true)}`
      : ""

  const gpuFallbackNote = job.gpu_fallback ? (
    <p
      className="rounded-md bg-amber-500/10 px-2 py-1 text-[10px] leading-snug text-amber-700 dark:text-amber-400"
      title={job.gpu_fallback_detail ?? undefined}
    >
      {job.gpu_fallback_reason ?? t("job.gpuFallback")}
    </p>
  ) : null

  /** Üst bölüm: dosya adı, klip aralığı, biçim/mod ve iptal menüsü. */
  const header = (
    <div className="flex items-start justify-between gap-1.5">
      <div className="min-w-0">
        <p
          className="truncate text-xs leading-5 font-semibold"
          title={job.output_filename ?? job.requested_filename ?? undefined}
        >
          {job.output_filename || job.requested_filename || t("job.preparing")}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] text-muted-foreground">
          {range && (
            <span className="font-mono tabular-nums">{range}</span>
          )}
          {range && <span aria-hidden>·</span>}
          <span className="rounded bg-muted px-1 py-px text-[9px] font-semibold tracking-wide text-foreground/75">
            {FORMAT_LABELS[job.output_format ?? "mp4"] ?? "MP4"}
          </span>
          {job.status === "pending" && job.lane && (
            <span className="rounded bg-primary/10 px-1 py-px text-[9px] font-semibold tracking-wide text-primary">
              {job.lane === "gpu" ? t("job.laneGpu") : t("job.laneCpu")}
            </span>
          )}
          <span
            title={job.auto_copy ? t("job.autoCopyHint") : undefined}
          >
            {job.mode === "fast" ? t("export.modeFast") : t("export.modeExact")}
          </span>
          {job.gpu_encoder && !job.gpu_fallback && (
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              {t("job.gpuShort")}
            </span>
          )}
        </div>
      </div>

      {canCancel && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="mt-0.5 shrink-0 cursor-pointer"
              data-slot="job-actions-trigger"
              aria-label={t("job.actions")}
              title={t("job.actions")}
            >
              <EllipsisVerticalIcon className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              variant="destructive"
              disabled={cancelJob.isPending}
              onSelect={() => cancelJob.mutate()}
            >
              <BanIcon />
              {t("job.cancel")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )

  if (job.status === "pending" || job.status === "running") {
    const progress = Math.max(0, Math.min(100, job.progress ?? 0))
    return (
      <JobCard status={job.status} queued={queued}>
        {header}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-muted-foreground">
              {queued
                ? t("job.queued", { position: job.queue_position ?? 1 })
                : job.status === "pending"
                  ? t("job.starting")
                  : t("job.processing")}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {job.eta_sec != null && job.eta_sec > 0 && (
                <span
                  className="text-[10px] font-normal text-muted-foreground tabular-nums"
                  title={t("job.remainingTitle")}
                >
                  {t("job.remaining", { time: formatRemaining(job.eta_sec) })}
                </span>
              )}
              <span className="font-mono text-xs font-semibold tabular-nums">
                {Math.round(progress)}%
              </span>
            </span>
          </div>
          <Progress value={progress} className="h-1.5" />
          <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span className="truncate tabular-nums">
              {job.current_sec != null && job.clip_duration != null
                ? `${job.current_sec.toFixed(0)}s / ${job.clip_duration.toFixed(0)}s`
                : ""}
            </span>
            {job.speed && (
              <span className="shrink-0">{t("job.speed", { speed: job.speed })}</span>
            )}
          </div>
        </div>
        {gpuFallbackNote}
      </JobCard>
    )
  }

  if (job.status === "done") {
    return (
      <>
        <JobCard
          status="done"
          thumbnail={
            job.output_filename
              ? { name: job.output_filename, version: job.created_at }
              : undefined
          }
        >
          {header}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                {t("job.ready")}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                {formatMegabytes(job.size_mb ?? 0)} ·{" "}
                {t("job.elapsed", { seconds: job.elapsed_sec ?? 0 })}
              </span>
            </div>
            {job.gpu_encoder && !job.gpu_fallback && (
              <p className="text-[10px] text-muted-foreground">
                {t("job.gpuUsed", { encoder: job.gpu_label ?? job.gpu_encoder })}
              </p>
            )}
            {gpuFallbackNote}
            <div className="flex flex-wrap gap-1.5">
              <Button
                ref={playButtonRef}
                size="xs"
                className="flex-1"
                disabled={!job.output_filename}
                onClick={() => {
                  usePlayerStore.getState().pause()
                  setPreviewOpen(true)
                }}
              >
                <PlayIcon />
                {t("common.play")}
              </Button>
              <Button size="xs" variant="outline" asChild>
                <a
                  href={`/exports/${encodeURIComponent(job.output_filename ?? "")}`}
                  download
                >
                  <DownloadIcon />
                  {t("common.download")}
                </a>
              </Button>
              <Button
                size="icon-xs"
                variant="outline"
                onClick={() => reveal.mutate(job.output_filename)}
                aria-label={t("common.reveal")}
                title={t("common.reveal")}
              >
                <FolderOpenIcon />
              </Button>
            </div>
          </div>
        </JobCard>
        <JobPreviewDialog
          job={previewOpen ? job : null}
          onClose={() => setPreviewOpen(false)}
          onRestoreFocus={() => playButtonRef.current?.focus()}
        />
      </>
    )
  }

  if (job.status === "error") {
    return (
      <JobCard status="error">
        {header}
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-destructive">{t("job.failed")}</p>
          <details className="rounded-md bg-muted/40 px-2 py-1.5">
            <summary className="cursor-pointer text-[10px] select-none text-muted-foreground hover:text-foreground">
              {t("job.errorDetails")}
            </summary>
            <pre className="mt-1 max-h-24 overflow-auto font-mono text-[10px] leading-snug whitespace-pre-wrap break-all text-muted-foreground">
              {job.error ?? t("job.failed")}
            </pre>
          </details>
          {gpuFallbackNote}
        </div>
      </JobCard>
    )
  }

  return (
    <JobCard status="cancelled">
      {header}
      <p className="text-[11px] text-muted-foreground">{t("job.cancelled")}</p>
    </JobCard>
  )
}
