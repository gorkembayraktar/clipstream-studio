/** Dışa aktarma işi (job) sorgu ve mutasyonları. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { toast } from "sonner"

import { api } from "@/lib/api"
import type { ExportRequest } from "@/lib/types"
import { log } from "@/stores/log-store"
import { useStudioStore } from "@/stores/studio-store"

export const jobKeys = {
  byId: (jobId: string) => ["job", jobId] as const,
}

export function useStartExport() {
  const addActiveJobId = useStudioStore((s) => s.addActiveJobId)
  return useMutation({
    mutationFn: (payload: ExportRequest) => api.createExportJob(payload),
    onSuccess: (data) => {
      log("success", `FFmpeg işlemi başlatıldı (ID: ${data.job_id}).`)
      addActiveJobId(data.job_id)
    },
    onError: (error: Error) => {
      log("error", "Dışa aktarma başlatılamadı", error.message)
      toast.error("Dışa aktarma başlatılamadı", { description: error.message })
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
  })
}

export function useCancelJob(jobId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.cancelJob(jobId as string),
    onSuccess: (data) => {
      if (data.success) {
        log("warn", "Dışa aktarım iptal edildi.")
        toast.info(data.message ?? "İşlem iptal edildi.")
        void queryClient.invalidateQueries({ queryKey: jobKeys.byId(jobId ?? "") })
      }
    },
    onError: (error: Error) => {
      log("error", "İptal isteği başarısız", error.message)
      toast.error("İptal edilemedi", { description: error.message })
    },
  })
}
