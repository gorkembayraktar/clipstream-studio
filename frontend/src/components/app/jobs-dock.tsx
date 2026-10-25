/** Sağ altta sabit duran, küçültülebilir dışa aktarma işleri paneli. */
import { useState } from "react"

import {
  ChevronDownIcon,
  CircleCheckIcon,
  DownloadIcon,
  ListXIcon,
} from "lucide-react"

import { JobProgress } from "@/components/app/job-progress"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { cn } from "cn"
import { useJobs } from "@/hooks/use-export-job"
import { useI18n } from "@/i18n"
import { clamp } from "@/lib/format"
import { useExportStore } from "@/stores/export-store"

export function JobsDock() {
  const activeJobIds = useExportStore((s) => s.activeJobIds)

  if (activeJobIds.length === 0) return null

  return <JobsDockPanel activeJobIds={activeJobIds} />
}

function JobsDockPanel({ activeJobIds }: { activeJobIds: string[] }) {
  const { t } = useI18n()
  const [collapsed, setCollapsed] = useState(false)
  const removeActiveJobIds = useExportStore((s) => s.removeActiveJobIds)
  const title = t("jobsDock.title")

  const results = useJobs(activeJobIds)
  const items = activeJobIds.map((jobId, index) => {
    const job = results[index]?.data
    return {
      jobId,
      status: job?.status,
      progress: job?.progress ?? 0,
    }
  })

  const isFinished = (status: (typeof items)[number]["status"]) =>
    status === "done" || status === "error" || status === "cancelled"

  // Çalışan işler daima üstte kalır; tamamlananlar aşağıda birikir.
  const activeItems = items.filter((item) => !isFinished(item.status))
  const finishedItems = items.filter((item) => isFinished(item.status))
  const orderedIds = [...activeItems, ...finishedItems].map((item) => item.jobId)

  const activeCount = activeItems.length
  const readyCount = finishedItems.filter((item) => item.status === "done").length
  const finishedCount = finishedItems.length
  const overall = activeCount
    ? Math.round(
        activeItems.reduce(
          (total, item) => total + clamp(item.progress, 0, 100),
          0,
        ) / activeCount,
      )
    : 0

  const summaryParts: string[] = []
  if (activeCount > 0) {
    summaryParts.push(
      `${overall}% · ${t("jobsDock.running", { count: activeCount })}`,
    )
  }
  if (readyCount > 0) {
    summaryParts.push(t("jobsDock.ready", { count: readyCount }))
  }
  if (summaryParts.length === 0) {
    summaryParts.push(t("jobsDock.finished", { count: finishedCount }))
  }

  const summary = summaryParts.join(" · ")

  return (
    <aside
      data-slot="jobs-dock"
      aria-label={`${title} · ${summary}`}
      className="fixed right-4 bottom-8 z-40 flex max-h-[70vh] w-[calc(100vw-2rem)] max-w-[380px] animate-in flex-col overflow-hidden rounded-xl border border-border/70 bg-card/95 shadow-2xl backdrop-blur duration-200 fade-in-0 slide-in-from-bottom-2"
    >
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          data-slot="jobs-dock-toggle"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          aria-controls="jobs-dock-body"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-muted/30 focus-visible:bg-muted/40 focus-visible:outline-none"
        >
          <span
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-lg",
              activeCount > 0
                ? "bg-primary/10 text-primary"
                : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            )}
          >
            {activeCount > 0 ? (
              <DownloadIcon className="size-3.5" aria-hidden />
            ) : (
              <CircleCheckIcon className="size-3.5" aria-hidden />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold">{title}</span>
            <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
              {summary}
            </span>
          </span>
        </button>

        {finishedCount > 0 && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="cursor-pointer text-muted-foreground"
            onClick={() => removeActiveJobIds(finishedItems.map((item) => item.jobId))}
            aria-label={t("jobsDock.clearFinished")}
            title={t("jobsDock.clearFinished")}
          >
            <ListXIcon />
          </Button>
        )}

        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          aria-controls="jobs-dock-body"
          aria-label={collapsed ? t("jobsDock.expand") : t("jobsDock.collapse")}
          title={collapsed ? t("jobsDock.expand") : t("jobsDock.collapse")}
          className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:bg-muted/40 focus-visible:outline-none"
        >
          <ChevronDownIcon
            className={cn(
              "size-4 transition-transform",
              collapsed && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </div>

      {activeCount > 0 && (
        <Progress
          value={overall}
          aria-label={`${title} ${overall}%`}
          className="h-0.5 rounded-none bg-muted/70"
        />
      )}

      <div
        id="jobs-dock-body"
        className={cn(
          "min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain border-t border-border/60 p-2",
          collapsed && "hidden",
        )}
      >
        {orderedIds.map((jobId) => (
          <JobProgress key={jobId} jobId={jobId} />
        ))}
      </div>
    </aside>
  )
}
