/** Galeri (exports/) verileri için TanStack Query sarmalayıcıları. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { toast } from "sonner"

import { translate } from "@/i18n"
import { api } from "@/lib/api"
import type { ExportFile } from "@/lib/types"
import { log } from "@/stores/log-store"

export const libraryKeys = {
  all: ["library"] as const,
  meta: (name: string, modified: number) =>
    ["library", "meta", name, modified] as const,
}

export function useLibrary() {
  return useQuery({
    queryKey: libraryKeys.all,
    queryFn: api.listLibrary,
  })
}

/** Yalnızca açık önizleme için ffprobe ayrıntılarını getirir. */
export function useLibraryFileMeta(file: ExportFile | null) {
  return useQuery({
    queryKey: libraryKeys.meta(file?.name ?? "", file?.modified ?? 0),
    queryFn: () => api.getLibraryFileMeta(file?.name ?? ""),
    enabled: file !== null,
    retry: 0,
    staleTime: 5 * 60_000,
  })
}

export function useDeleteLibraryFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api.deleteLibraryFile(name),
    onSuccess: (_data, name) => {
      log("success", translate("log.fileDeleted", { name }))
      toast.success(translate("gallery.deleted"))
      void queryClient.invalidateQueries({ queryKey: libraryKeys.all })
    },
    onError: (error: Error, name) => {
      log("error", translate("log.fileDeleteFailed"), `${name} — ${error.message}`)
      toast.error(translate("gallery.deleteFailed"), { description: error.message })
    },
  })
}

export function useRevealInExplorer() {
  return useMutation({
    mutationFn: (filename?: string) => api.revealInExplorer(filename),
    onSuccess: () => {
      log("info", translate("gallery.revealSuccess"))
      toast.success(translate("gallery.revealSuccess"))
    },
    onError: (error: Error) => {
      log("error", translate("log.folderOpenFailed"), error.message)
      toast.error(translate("gallery.revealFailed"), { description: error.message })
    },
  })
}
