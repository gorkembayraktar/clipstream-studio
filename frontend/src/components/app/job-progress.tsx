/** Dışa aktarma işinin canlı ilerlemesi ve sonuç kartı (paralel işler için çoklanır). */
import { useEffect } from "react"

import { useQueryClient } from "@tanstack/react-query"
import {
  CircleCheckIcon,
  DownloadIcon,
  FolderOpenIcon,
  Loader2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useCancelJob, useJob } from "@/hooks/use-export-job"
import { libraryKeys, useRevealInExplorer } from "@/hooks/use-library"
import { formatTime } from "@/lib/format"
import { log } from "@/stores/log-store"
import { useStudioStore } from "@/stores/studio-store"

const FORMAT_LABELS: Record<string, string> = { mp4: "MP4", gif: "GIF", mp3: "MP3" }

/** Bildirimler kart kapatılıp yeniden açılsa da iş başına yalnızca bir kez gösterilir. */
const notifiedStates = new Set<string>()

export function JobProgress({ jobId }: { jobId: string }) {
  const { data: job } = useJob(jobId)
  const cancelJob = useCancelJob(jobId)
  const reveal = useRevealInExplorer()
  const removeActiveJobId = useStudioStore((s) => s.removeActiveJobId)
  const queryClient = useQueryClient()

  // Durum geçişlerinde tek seferlik bildirim + galeri tazeleme
  useEffect(() => {
    if (!job?.status) return
    const key = `${job.id}:${job.status}`
    if (notifiedStates.has(key)) return
    notifiedStates.add(key)

    if (job.status === "done") {
      log(
        "success",
        `Klip oluşturuldu: ${job.output_filename} (${job.size_mb} MB, süre: ${job.elapsed_sec} sn)`,
      )
      toast.success("Klip hazır", { description: job.output_filename })
    } else if (job.status === "error") {
      log("error", "Dışa aktarma başarısız", job.error?.slice(0, 300))
      toast.error("Dışa aktarma başarısız", { description: job.error?.slice(0, 140) })
    } else if (job.status === "cancelled") {
      log("warn", "Dışa aktarma iptal edildi.")
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
        <span>{job?.mode === "fast" ? "hızlı" : "hassas"}</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-5"
          aria-label="Kartı kapat"
          title="Kartı kapat (işlem başladıysa sürer)"
          onClick={() => removeActiveJobId(jobId)}
        >
          <XIcon className="size-3" />
        </Button>
      </span>
    </div>
  )

  if (!job) {
    return (
      <div className="flex items-center gap-2 rounded-lg border p-2.5 text-xs text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" />
        İş hazırlanıyor…
      </div>
    )
  }

  if (job.status === "pending" || job.status === "running") {
    const progress = Math.max(0, Math.min(100, job.progress ?? 0))
    return (
      <div className={widthClass}>
        {header}
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" />
            {job.status === "pending" ? "Başlatılıyor…" : "İşleniyor…"}
          </span>
          <span className="font-mono tabular-nums">{Math.round(progress)}%</span>
        </div>
        <Progress value={progress} />
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
            {job.speed && <span>hız {job.speed}</span>}
            <Button
              variant="ghost"
              size="xs"
              onClick={() => cancelJob.mutate()}
              disabled={cancelJob.isPending}
            >
              <XIcon />
              İptal
            </Button>
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
          Klip hazır
        </div>
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          {job.output_filename}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {job.size_mb} MB · {job.elapsed_sec} sn
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" asChild>
            <a
              href={`/exports/${encodeURIComponent(job.output_filename ?? "")}`}
              download
            >
              <DownloadIcon />
              İndir
            </a>
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => reveal.mutate(job.output_filename)}
          >
            <FolderOpenIcon />
            Klasörde Göster
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
          Dışa aktarma başarısız
        </div>
        <pre className="max-h-28 overflow-auto text-[10px] whitespace-pre-wrap break-all text-muted-foreground">
          {job.error}
        </pre>
      </div>
    )
  }

  return (
    <div className={widthClass}>
      {header}
      <p className="text-xs text-muted-foreground">İşlem iptal edildi.</p>
    </div>
  )
}
