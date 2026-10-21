/** Sağ altta sabit duran, küçültülebilir dışa aktarma işleri paneli. */
import { useState } from "react"

import { ChevronDownIcon, DownloadIcon } from "lucide-react"

import { JobProgress } from "@/components/app/job-progress"
import { cn } from "cn"
import { useI18n } from "@/i18n"
import { useStudioStore } from "@/stores/studio-store"

export function JobsDock() {
  const activeJobIds = useStudioStore((s) => s.activeJobIds)

  if (activeJobIds.length === 0) return null

  return <JobsDockPanel activeJobIds={activeJobIds} />
}

function JobsDockPanel({ activeJobIds }: { activeJobIds: string[] }) {
  const { t } = useI18n()
  const [collapsed, setCollapsed] = useState(false)
  const title = t("jobsDock.title")

  return (
    <aside
      data-slot="jobs-dock"
      aria-label={`${title} (${activeJobIds.length})`}
      className="fixed right-4 bottom-12 z-40 flex max-h-[70vh] w-[calc(100vw-2rem)] max-w-[380px] flex-col overflow-hidden rounded-xl border border-border/70 bg-card/95 shadow-2xl backdrop-blur"
    >
      <button
        type="button"
        data-slot="jobs-dock-toggle"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
        aria-controls="jobs-dock-body"
        aria-label={collapsed ? t("jobsDock.expand") : t("jobsDock.collapse")}
        title={collapsed ? t("jobsDock.expand") : t("jobsDock.collapse")}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/30 focus-visible:bg-muted/40 focus-visible:outline-none"
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <DownloadIcon className="size-3.5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold">{title}</span>
          <span className="block text-[10px] text-muted-foreground">
            {t("jobsDock.count", { count: activeJobIds.length })}
          </span>
        </span>
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            collapsed && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      <div
        id="jobs-dock-body"
        className={cn(
          "min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain border-t border-border/60 p-2.5",
          collapsed && "hidden",
        )}
      >
        {activeJobIds.map((jobId) => (
          <JobProgress key={jobId} jobId={jobId} />
        ))}
      </div>
    </aside>
  )
}
