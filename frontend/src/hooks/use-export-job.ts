/** Dışa aktarma işi (job) sorgu ve mutasyonları. */
import { useEffect } from "react"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { toast } from "@/lib/notify"

import { translate } from "@/i18n"
import { api } from "@/lib/api"
import type { ExportRequest } from "@/lib/types"
import { log } from "@/stores/log-store"
import { useExportStore } from "@/stores/export-store"

/** Pano yoklama aralığı. Kart ilerlemesi bu sıklıkta tazelenir. */
const POLL_MS = 800

export const jobKeys = {
  byId: (jobId: string) => ["job", jobId] as const,
  /** Panodaki iş kümesi; `["jobs", ...]` öneki tüm yoklama sorgularını kapsar. */
  all: ["jobs"] as const,
  batch: (jobIds: string[]) =>
    ["jobs", [...jobIds].sort().join(",")] as const,
}

/** Panodaki işleri **tek** istekte yoklar.
 *
 * Her kart kendi `/api/jobs/{id}` isteğini 600 ms'de bir atsaydı N iş için
 * saniyede N istek doğardı; ayrıca her yanıt iş sözlüğünün tamamını
 * serileştirirdi. Kimlik listesi sabit olduğu için biten iş son durumunu
 * (done/error/cancelled) de alır; kart "running" durumunda takılmaz.
 */
export function useJobsPoll(jobIds: string[]) {
  return useQuery({
    queryKey: jobKeys.batch(jobIds),
    queryFn: () => api.listJobsByIds(jobIds),
    enabled: jobIds.length > 0,
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? []
      const active = jobs.some(
        (job) => job.status === "pending" || job.status === "running",
      )
      return active ? POLL_MS : false
    },
    // Başka sekmedeyken de yüzde güncellenmeye devam etsin.
    refetchIntervalInBackground: true,
  })
}

export function useStartExport() {
  const addActiveJobId = useExportStore((s) => s.addActiveJobId)
  return useMutation({
    mutationFn: (payload: ExportRequest) => api.createExportJob(payload),
    onSuccess: (data) => {
      log("success", translate("log.exportStarted", { id: data.job_id }))
      addActiveJobId(data.job_id)
    },
    onError: (error: Error) => {
      log("error", translate("log.exportStartFailed"), error.message)
      toast.error(translate("log.exportStartFailed"), { description: error.message })
    },
  })
}

/** Sayfa tam yenilendiğinde backend'de süren işleri panoya geri yükler.
 *
 * `activeJobIds` yalnızca bellekte tutulduğu için yenilemede kaybolur;
 * işler backend'de çalışmaya devam ettiğinden liste buradan geri alınır.
 */
export function useActiveJobsHydration() {
  const addActiveJobId = useExportStore((s) => s.addActiveJobId)

  useEffect(() => {
    let cancelled = false
    void api
      .listJobs(true)
      .then((data) => {
        if (cancelled) return
        // Backend en eskiyi önce verir; addActiveJobId başa eklediği için
        // pano en yeni işi üstte göstermeye devam eder.
        for (const job of data.jobs) addActiveJobId(job.id)
      })
      .catch(() => {
        // Pano sessiz kalsın; backend'e ulaşılamıyorsa gösterilecek iş yoktur.
      })
    return () => {
      cancelled = true
    }
  }, [addActiveJobId])
}

/** Panodaki tüm işler. Kartlar aynı yoklama isteğini paylaşır. */
export function useJobs(jobIds: string[]) {
  const query = useJobsPoll(jobIds)
  return jobIds.map((jobId) => ({
    data: query.data?.jobs.find((job) => job.id === jobId),
  }))
}

/** Tek iş; veriyi panonun paylaştığı yoklama isteğinden okur.
 *
 * Kart başına ayrı istek atmak yerine pano sorgusuna abone olunur. Aynı
 * kimlik kümesi aynı sorgu anahtarını ürettiği için tek HTTP isteği yeter.
 */
export function useJob(jobId: string | null) {
  const jobIds = useExportStore((s) => s.activeJobIds)
  const query = useJobsPoll(jobIds)
  return {
    data: jobId
      ? query.data?.jobs.find((job) => job.id === jobId)
      : undefined,
  }
}

export function useCancelJob(jobId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.cancelJob(jobId as string),
    onSuccess: (data) => {
      if (data.success) {
        log("warn", translate("log.exportCancelled"))
        toast.info(translate("job.cancelled"))
        // Durum hemen yansısın; bir sonraki yoklamayı bekleme.
        void queryClient.invalidateQueries({ queryKey: jobKeys.all })
      }
    },
    onError: (error: Error) => {
      log("error", translate("log.cancelFailed"), error.message)
      toast.error(translate("log.cancelFailed"), { description: error.message })
    },
  })
}
