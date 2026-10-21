/** Sekme başlığında çalışan dışa aktarma işlerinin yüzdesini gösterir. */
import { useEffect } from "react"

import type { JobStatus } from "@/lib/types"

const DEFAULT_TITLE = typeof document === "undefined" ? "ClipStream Studio" : document.title

interface TitleJob {
  status: JobStatus
  progress: number
}

/** Kartlar ayrı ayrı mount olduğu için iş durumları burada toplanır. */
const titleJobs = new Map<string, TitleJob>()

function applyTitle() {
  const active = Array.from(titleJobs.values()).filter(
    (job) => job.status === "pending" || job.status === "running",
  )

  if (active.length === 0) {
    document.title = DEFAULT_TITLE
    return
  }

  const progress = Math.round(
    active.reduce((total, job) => total + Math.max(0, Math.min(100, job.progress)), 0) /
      active.length,
  )
  document.title = `%${progress} · ClipStream Studio`
}

/**
 * İş kartındaki güncel durumu başlığa yansıtır. Birden fazla iş varsa
 * ilerlemelerin ortalaması gösterilir; iş bitince özgün başlık geri gelir.
 */
export function useExportTitle(
  jobId: string,
  status: JobStatus | undefined,
  progress: number | undefined,
) {
  useEffect(() => {
    if (!status) {
      titleJobs.delete(jobId)
      applyTitle()
      return
    }

    titleJobs.set(jobId, { status, progress: progress ?? 0 })
    applyTitle()
  }, [jobId, progress, status])

  useEffect(
    () => () => {
      titleJobs.delete(jobId)
      applyTitle()
    },
    [jobId],
  )
}
