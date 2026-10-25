/** Galeri (exports/) verileri için TanStack Query sarmalayıcıları. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { toast } from "sonner"

import { translate } from "@/i18n"
import { api, ApiError } from "@/lib/api"
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

export interface DeleteLibraryFileFailure {
  name: string
  error: string
}

export interface DeleteLibraryFilesResult {
  deleted: string[]
  failed: DeleteLibraryFileFailure[]
}

/** Yerel sunucuyu boğmamak için toplu silmede en fazla iki eşzamanlı istek. */
const DELETE_CONCURRENCY = 2

async function deleteLibraryFiles(
  names: string[],
): Promise<DeleteLibraryFilesResult> {
  const deleted: string[] = []
  const failed: DeleteLibraryFileFailure[] = []
  let cursor = 0

  const worker = async () => {
    while (cursor < names.length) {
      const index = cursor
      cursor += 1
      const name = names[index]

      try {
        // Toplu işlem tek bir özet log/toast üretir; API katmanı sessiz çalışır.
        await api.deleteLibraryFile(name, { silent: true })
        deleted.push(name)
      } catch (error) {
        // Liste bayatlamış olabilir: 404 zaten silinmiş sayılır.
        if (error instanceof ApiError && error.status === 404) {
          deleted.push(name)
          continue
        }
        failed.push({
          name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  const workerCount = Math.min(DELETE_CONCURRENCY, names.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  const order = new Map(names.map((name, index) => [name, index]))
  failed.sort(
    (a, b) => (order.get(a.name) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.name) ?? Number.MAX_SAFE_INTEGER),
  )

  return { deleted, failed }
}

/**
 * Birden çok dosyayı tek işlemde siler. Tek bir toast ve özet log üretir;
 * kütüphane sorgusunu tüm istekler bittikten sonra yalnızca bir kez yeniler.
 */
export function useDeleteLibraryFiles() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (names: string[]) => deleteLibraryFiles(names),
    onSuccess: (result, names) => {
      const total = names.length
      const deleted = result.deleted.length
      const failedDetails = result.failed
        .map((failure) => `${failure.name}: ${failure.error}`)
        .join(" · ")

      if (result.failed.length === 0) {
        log(
          "success",
          translate("log.bulkDeleteSummary", { deleted, total }),
        )
        toast.success(
          total === 1
            ? translate("gallery.deletedOne")
            : translate("gallery.deletedMany", { count: deleted }),
        )
        return
      }

      if (deleted === 0) {
        log(
          "error",
          translate("log.bulkDeleteSummary", { deleted, total }),
          failedDetails,
        )
        toast.error(
          total === 1
            ? translate("gallery.deleteManyFailedOne")
            : translate("gallery.deleteManyFailed"),
          { description: failedDetails },
        )
        return
      }

      log(
        "warn",
        translate("log.bulkDeleteSummary", { deleted, total }),
        failedDetails,
      )
      toast.warning(
        translate("gallery.deleteManyPartial", { deleted, total }),
        { description: failedDetails },
      )
    },
    onError: (error: Error, names) => {
      log(
        "error",
        translate("log.bulkDeleteSummary", {
          deleted: 0,
          total: names.length,
        }),
        error.message,
      )
      toast.error(
        names.length === 1
          ? translate("gallery.deleteManyFailedOne")
          : translate("gallery.deleteManyFailed"),
        { description: error.message },
      )
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: libraryKeys.all })
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
