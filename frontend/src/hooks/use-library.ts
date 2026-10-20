/** Galeri (exports/) verileri için TanStack Query sarmalayıcıları. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { toast } from "sonner"

import { api } from "@/lib/api"
import { log } from "@/stores/log-store"

export const libraryKeys = {
  all: ["library"] as const,
}

export function useLibrary() {
  return useQuery({
    queryKey: libraryKeys.all,
    queryFn: api.listLibrary,
  })
}

export function useDeleteLibraryFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api.deleteLibraryFile(name),
    onSuccess: (_data, name) => {
      log("success", `Dosya silindi: ${name}`)
      toast.success("Dosya silindi.")
      void queryClient.invalidateQueries({ queryKey: libraryKeys.all })
    },
    onError: (error: Error, name) => {
      log("error", "Dosya silinemedi", `${name} — ${error.message}`)
      toast.error("Dosya silinemedi", { description: error.message })
    },
  })
}

export function useRevealInExplorer() {
  return useMutation({
    mutationFn: (filename?: string) => api.revealInExplorer(filename),
    onSuccess: (data) => {
      if (data.message) {
        log("info", data.message)
        toast.success(data.message)
      }
    },
    onError: (error: Error) => {
      log("error", "Klasör açılamadı", error.message)
      toast.error("Klasör açılamadı", { description: error.message })
    },
  })
}
