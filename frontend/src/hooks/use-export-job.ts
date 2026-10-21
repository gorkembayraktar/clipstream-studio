/** Dışa aktarma işi (job) sorgu ve mutasyonları. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { toast } from "sonner"

import { translate } from "@/i18n"
import { api } from "@/lib/api"
import type { ExportRequest } from "@/lib/types"
import { log } from "@/stores/log-store"
import { useExportStore } from "@/stores/export-store"

export const jobKeys = {
  byId: (jobId: string) => ["job", jobId] as const,
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

/** İş durumunu yoklar; iş bitene kadar 600 ms'de bir yeniler. */
export function useJob(jobId: string | null) {
  return useQuery({
    queryKey: jobKeys.byId(jobId ?? ""),
    queryFn: () => api.getJob(jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "pending" || status === "running" ? 600 : false
    },
    // Başka sekmedeyken de yüzde güncellenmeye devam etsin.
    refetchIntervalInBackground: true,
  })
}

export function useCancelJob(jobId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.cancelJob(jobId as string),
    onSuccess: (data) => {
      if (data.success) {
        log("warn", translate("log.exportCancelled"))
        toast.info(translate("job.cancelled"))
        void queryClient.invalidateQueries({ queryKey: jobKeys.byId(jobId ?? "") })
      }
    },
    onError: (error: Error) => {
      log("error", translate("log.cancelFailed"), error.message)
      toast.error(translate("log.cancelFailed"), { description: error.message })
    },
  })
}
