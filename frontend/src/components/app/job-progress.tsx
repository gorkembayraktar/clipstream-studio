/** Dışa aktarma işinin canlı ilerlemesi ve sonuç kartı (paralel işler için çoklanır). */
import { useEffect } from "react"

import { useQueryClient } from "@tanstack/react-query"
import {
  BanIcon,
  CircleCheckIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  FolderOpenIcon,
  Loader2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { useCancelJob, useJob } from "@/hooks/use-export-job"
import { useExportTitle } from "@/hooks/use-export-title"
import { libraryKeys, useRevealInExplorer } from "@/hooks/use-library"
import { translate, useI18n } from "@/i18n"
import { formatTime, formatMegabytes, formatRemaining } from "@/lib/format"
import { log } from "@/stores/log-store"
import { useStudioStore } from "@/stores/studio-store"

const FORMAT_LABELS: Record<string, string> = { mp4: "MP4", gif: "GIF", mp3: "MP3" }

/** Bildirimler kart kapatılıp yeniden açılsa da iş başına yalnızca bir kez gösterilir. */
const notifiedStates = new Set<string>()

export function JobProgress({ jobId }: { jobId: string }) {
  const { t } = useI18n()
  const { data: job } = useJob(jobId)
  const cancelJob = useCancelJob(jobId)
  const reveal = useRevealInExplorer()
  const removeActiveJobId = useStudioStore((s) => s.removeActiveJobId)
  const queryClient = useQueryClient()

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

  const widthClass = "space-y-2 rounded-lg border p-2.5"

  /** Kart başlığı: klip aralığı, biçim/mod ve kapatma düğmesi. */
  const header = (
    <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
      <span className="truncate font-mono tabular-nums">
        {job?.clip_start != null && job?.clip_end != null
          ? `${formatTime(job.clip_start, true)} → ${formatTime(job.clip_end, true)}`
          : ""}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="uppercase">
          {FORMAT_LABELS[job?.output_format ?? "mp4"] ?? "MP4"}
        </span>
        <span>·</span>
        <span>{job?.mode === "fast" ? t("export.modeFast") : t("export.modeExact")}</span>
        {job?.gpu_encoder && (
          <>
            <span>·</span>
            <span className="font-medium text-emerald-500">{t("job.gpuShort")}</span>
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-5"
              data-slot="job-actions-trigger"
              aria-label={t("job.actions")}
              title={t("job.actions")}
            >
              <EllipsisVerticalIcon className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {(job?.status === "pending" || job?.status === "running") && (
              <>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={cancelJob.isPending}
                  onSelect={() => cancelJob.mutate()}
                >
                  <BanIcon />
                  {t("job.cancel")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              title={t("job.closeCardTitle")}
              onSelect={() => removeActiveJobId(jobId)}
            >
              <XIcon />
              {t("job.closeCard")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </div>
  )

  if (!job) {
    return (
      <div className="flex items-center gap-2 rounded-lg border p-2.5 text-xs text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" />
        {t("job.preparing")}
      </div>
    )
  }

  const gpuFallbackNote = job.gpu_fallback ? (
    <p
      className="text-[11px] leading-snug text-amber-500"
      title={job.gpu_fallback_detail ?? undefined}
    >
      {job.gpu_fallback_reason ?? t("job.gpuFallback")}
    </p>
  ) : null

  if (job.status === "pending" || job.status === "running") {
    const progress = Math.max(0, Math.min(100, job.progress ?? 0))
    return (
      <div className={widthClass}>
        {header}
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" />
            {job.status === "pending" ? t("job.starting") : t("job.processing")}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {job.eta_sec != null && job.eta_sec > 0 && (
              <span
                className="whitespace-nowrap text-[11px] font-normal text-muted-foreground tabular-nums"
                title={t("job.remainingTitle")}
              >
                {t("job.remaining", { time: formatRemaining(job.eta_sec) })}
              </span>
            )}
            <span className="font-mono tabular-nums">{Math.round(progress)}%</span>
          </span>
        </div>
        <Progress value={progress} />
        {gpuFallbackNote}
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="truncate font-mono tabular-nums">
            {job.output_filename ?? ""}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {job.current_sec != null && job.clip_duration != null && (
              <span className="tabular-nums">
                {job.current_sec.toFixed(0)}s / {job.clip_duration.toFixed(0)}s
              </span>
            )}
            {job.speed && <span>{t("job.speed", { speed: job.speed })}</span>}
          </span>
        </div>
      </div>
    )
  }

  if (job.status === "done") {
    return (
      <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5">
        {header}
        <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-500">
          <CircleCheckIcon className="size-3.5" />
          {t("job.ready")}
        </div>
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          {job.output_filename}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {formatMegabytes(job.size_mb ?? 0)} · {t("job.elapsed", { seconds: job.elapsed_sec ?? 0 })}
        </p>
        {job.gpu_encoder && !job.gpu_fallback && (
          <p className="text-[11px] text-muted-foreground">
            {t("job.gpuUsed", { encoder: job.gpu_label ?? job.gpu_encoder })}
          </p>
        )}
        {gpuFallbackNote}
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" asChild>
            <a
              href={`/exports/${encodeURIComponent(job.output_filename ?? "")}`}
              download
            >
              <DownloadIcon />
              {t("common.download")}
            </a>
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => reveal.mutate(job.output_filename)}
          >
            <FolderOpenIcon />
            {t("common.reveal")}
          </Button>
        </div>
      </div>
    )
  }

  if (job.status === "error") {
    return (
      <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5">
        {header}
        <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
          <TriangleAlertIcon className="size-3.5" />
          {t("job.failed")}
        </div>
        <pre className="max-h-28 overflow-auto text-[10px] whitespace-pre-wrap break-all text-muted-foreground">
          {job.error}
        </pre>
        {gpuFallbackNote}
      </div>
    )
  }

  return (
    <div className={widthClass}>
      {header}
      <p className="text-xs text-muted-foreground">{t("job.cancelled")}</p>
    </div>
  )
}
