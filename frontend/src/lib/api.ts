/** Backend'e erişen tipli HTTP istemcisi. */
import { getLocale, translate } from "@/i18n"
import type {
  ExportFile,
  ExportJob,
  ExportRequest,
  LocalPickResponse,
  LocalUploadResponse,
  ProbeResponse,
  ResolveResponse,
  WaveformResponse,
} from "@/lib/types"
import { log } from "@/stores/log-store"

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

/** Backend hata mesajlarını arayüz diliyle üretmesi için istek dili. */
function acceptLanguage(): string {
  return getLocale() === "tr" ? "tr-TR" : "en-US"
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json")
  headers.set("Accept-Language", acceptLanguage())

  let response: Response
  try {
    response = await fetch(path, { ...init, headers })
  } catch (error) {
    // Kullanıcı iptal ettiyse hata gibi gösterme; çağıran taraf ayırt eder.
    if (error instanceof DOMException && error.name === "AbortError") throw error
    const message = translate("api.unreachable")
    log("error", message, path)
    throw new ApiError(message, 0)
  }

  const text = await response.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }

  if (!response.ok) {
    const message =
      (data as { error?: string } | null)?.error ??
      translate("api.httpFailed", { status: response.status })
    log(
      "error",
      translate("log.requestFailed", { path }),
      `HTTP ${response.status} — ${message}`,
    )
    throw new ApiError(message, response.status)
  }

  return data as T
}

const post = <T,>(path: string, body?: unknown, init?: RequestInit): Promise<T> =>
  request<T>(path, {
    ...init,
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  })

/**
 * Yerel video dosyasını sunucuya yükler.
 *
 * Gövde ham dosyadır (multipart değil): büyük dosyalar bellek şişirmeden akar.
 * `XMLHttpRequest` kullanılır çünkü `fetch` yükleme ilerlemesi bildirmez.
 */
function uploadLocalFile(
  file: File,
  options: {
    onProgress?: (ratio: number) => void
    /** Dosya tamamen gönderildi (sunucu artık hazırlıyor). */
    onUploaded?: () => void
    signal?: AbortSignal
  } = {},
): Promise<LocalUploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", `/api/local/upload?name=${encodeURIComponent(file.name)}`)
    xhr.setRequestHeader("Content-Type", "application/octet-stream")
    xhr.setRequestHeader("Accept-Language", acceptLanguage())
    xhr.timeout = 0

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        options.onProgress?.(event.loaded / event.total)
      }
    }
    xhr.upload.onload = () => options.onUploaded?.()

    xhr.onload = () => {
      let data: unknown = null
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null
      } catch {
        data = null
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as LocalUploadResponse)
        return
      }
      const message =
        (data as { error?: string } | null)?.error ??
        translate("api.uploadHttpFailed", { status: xhr.status })
      log(
        "error",
        translate("api.uploadFailed"),
        `HTTP ${xhr.status} — ${message}`,
      )
      reject(new ApiError(message, xhr.status))
    }
    xhr.onerror = () => {
      const message = translate("api.unreachable")
      log("error", message, "/api/local/upload")
      reject(new ApiError(message, 0))
    }
    xhr.onabort = () =>
      reject(new DOMException(translate("log.uploadCancelled"), "AbortError"))

    options.signal?.addEventListener("abort", () => xhr.abort(), { once: true })
    xhr.send(file)
  })
}

export const api = {
  resolve: (url: string, headers?: Record<string, string> | null) =>
    post<ResolveResponse>("/api/media/resolve", { url, headers: headers ?? undefined }),
  probe: (url: string, headers?: Record<string, string> | null) =>
    post<ProbeResponse>("/api/media/probe", { url, headers: headers ?? undefined }),
  uploadLocalFile,
  /** Kopyasız yerel dosya seçimi: sunucu Windows dosya penceresini açar. */
  pickLocalFile: (signal?: AbortSignal) =>
    post<LocalPickResponse>("/api/local/pick", undefined, { signal }),
  /** Süren yerel dosya işlemini iptal eder (pencereyi kapatır, remux'u durdurur). */
  cancelLocal: () =>
    post<{ success: boolean; dialog_closed: boolean; remux_stopped: boolean }>(
      "/api/local/cancel",
    ),
  waveform: (payload: {
    url: string
    origin?: string
    duration?: number
    force?: boolean
    /** Video akışı sessizse sesin alınacağı ayrı akış. */
    audio_url?: string
    /** curl ile yapıştırılan HTTP başlıkları. */
    headers?: Record<string, string>
  }) => post<WaveformResponse>("/api/waveform", payload),

  /** Önizleme karesi: videoyu ilerletmeden sunucuda çekilen JPEG. */
  frame: async (
    payload: {
      url: string
      origin?: string
      time: number
      headers?: Record<string, string>
    },
    signal?: AbortSignal,
  ): Promise<Blob> => {
    let response: Response
    try {
      response = await fetch("/api/frame", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept-Language": acceptLanguage(),
        },
        body: JSON.stringify(payload),
        signal,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error
      throw new ApiError(translate("api.unreachable"), 0)
    }

    if (!response.ok) {
      let message = translate("api.frameFailed", { status: response.status })
      try {
        const data = (await response.json()) as { error?: string }
        if (data?.error) message = data.error
      } catch {
        /* gövde JSON değilse varsayılan mesaj kalır */
      }
      throw new ApiError(message, response.status)
    }

    return response.blob()
  },

  createExportJob: (payload: ExportRequest) =>
    post<{ success: boolean; job_id: string }>("/api/jobs", payload),
  getJob: (jobId: string) => request<ExportJob>(`/api/jobs/${jobId}`),
  cancelJob: (jobId: string) =>
    post<{ success: boolean; message?: string }>(`/api/jobs/${jobId}/cancel`),

  listLibrary: () => request<{ files: ExportFile[] }>("/api/library"),
  deleteLibraryFile: (name: string) =>
    request<{ success: boolean; message?: string }>(
      `/api/library/${encodeURIComponent(name)}`,
      { method: "DELETE" },
    ),
  revealInExplorer: (filename?: string) =>
    post<{ success: boolean; message?: string }>(
      "/api/library/reveal",
      filename ? { filename } : {},
    ),
}
