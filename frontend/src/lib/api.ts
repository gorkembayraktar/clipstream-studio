/** Backend'e erişen tipli HTTP istemcisi. */
import { getLocale, translate } from "@/i18n"
import type {
  ExportCapabilities,
  ExportFile,
  ExportJob,
  ExportRequest,
  JobsResponse,
  LibraryFileMeta,
  LocalPickResponse,
  LocalUploadResponse,
  ProbeResponse,
  Recording,
  ResolveResponse,
  StartRecordingRequest,
  StoryboardBatchMeta,
  StreamSummary,
  SubtitleResponse,
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

async function request<T>(
  path: string,
  init?: RequestInit,
  options?: { silent?: boolean },
): Promise<T> {
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
    if (!options?.silent) log("error", message, path)
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
    if (!options?.silent) {
      log(
        "error",
        translate("log.requestFailed", { path }),
        `HTTP ${response.status} — ${message}`,
      )
    }
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

export interface ResolveProgressEvent {
  type: "progress" | "done" | "error" | "cancelled"
  percent?: number
  stage?: "resolving" | "downloading" | "transcoding" | "ready"
  detail?: string
  result?: ResolveResponse
  error?: string
  is_ytdlp_missing?: boolean
  status_code?: number
}

async function resolveStream(
  url: string,
  headers?: Record<string, string> | null,
  options?: {
    onProgress?: (event: ResolveProgressEvent) => void
    signal?: AbortSignal
  },
): Promise<ResolveResponse> {
  const response = await fetch("/api/media/resolve/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": acceptLanguage(),
    },
    body: JSON.stringify({ url, headers: headers ?? undefined }),
    signal: options?.signal,
  })

  if (!response.ok) {
    const text = await response.text()
    let message = translate("api.httpFailed", { status: response.status })
    try {
      const data = JSON.parse(text)
      if (data?.error) message = data.error
    } catch {
      // noop
    }
    throw new ApiError(message, response.status)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new ApiError(translate("api.unreachable"), 0)
  }

  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const event = JSON.parse(trimmed) as ResolveProgressEvent
        if (event.type === "progress") {
          options?.onProgress?.(event)
        } else if (event.type === "done" && event.result) {
          return event.result
        } else if (event.type === "cancelled") {
          throw new DOMException(translate("log.uploadCancelled"), "AbortError")
        } else if (event.type === "error") {
          throw new ApiError(event.error || translate("api.unreachable"), event.status_code || 400)
        }
      } catch (e) {
        if (e instanceof ApiError || (e instanceof DOMException && e.name === "AbortError")) {
          throw e
        }
      }
    }
  }

  throw new ApiError(translate("api.unreachable"), 400)
}

export const api = {
  resolve: (url: string, headers?: Record<string, string> | null) =>
    post<ResolveResponse>("/api/media/resolve", { url, headers: headers ?? undefined }),
  resolveStream,
  probe: (
    url: string,
    headers?: Record<string, string> | null,
    headerToken?: string | null,
  ) =>
    post<ProbeResponse>("/api/media/probe", {
      url,
      headers: headers ?? undefined,
      header_token: headerToken ?? undefined,
    }),
  /** HLS altyazı playlist'ini tek bir WebVTT metnine dönüştürür. */
  subtitles: (
    url: string,
    headers?: Record<string, string> | null,
    signal?: AbortSignal,
  ) =>
    post<SubtitleResponse>(
      "/api/media/subtitles",
      { url, headers: headers ?? undefined },
      { signal },
    ),
  uploadLocalFile,
  /** Kopyasız yerel dosya seçimi: sunucu Windows dosya penceresini açar. */
  pickLocalFile: (signal?: AbortSignal) =>
    post<LocalPickResponse>("/api/local/pick", undefined, { signal }),
  /** Süren yerel dosya işlemini iptal eder (pencereyi kapatır, remux'u durdurur). */
  cancelLocal: () =>
    post<{ success: boolean; dialog_closed: boolean; remux_stopped: boolean }>(
      "/api/local/cancel",
    ),
  /** Zaman çizelgesi storyboard'u: istenen 10 karelik grubu hazırlayıp döner. */
  storyboard: (
    payload: {
      url: string
      origin?: string
      duration: number
      /** Yerel dosyanın kalıcı kimliği (yeniden başlatmada önbellek için). */
      identity?: string
      headers?: Record<string, string>
      /** Kademeli önizleme grubu (0 tabanlı). */
      batch?: number
    },
    signal?: AbortSignal,
  ) => post<StoryboardBatchMeta>("/api/storyboard", payload, { signal }),
  waveform: (payload: {
    url: string
    origin?: string
    duration?: number
    force?: boolean
    /** `false` ise yeni çıkarım yapılmaz; yalnızca önbellek sunulur. */
    generate?: boolean
    /** Video akışı sessizse sesin alınacağı ayrı akış. */
    audio_url?: string
    /** Seçili ses rendition'ının kararlı kimliği (önbellek ayrımı için). */
    audio_track?: string
    /** curl ile yapıştırılan HTTP başlıkları. */
    headers?: Record<string, string>
  }) => post<WaveformResponse>("/api/waveform", payload),

  /** Kademeli waveform: NDJSON olaylarını ham `Response` olarak döndürür. */
  waveformStream: async (
    payload: {
      url: string
      origin?: string
      duration?: number
      force?: boolean
      /** `false` ise yeni çıkarım yapılmaz; yalnızca önbellek sunulur. */
      generate?: boolean
      audio_url?: string
      /** Seçili ses rendition'ının kararlı kimliği (önbellek ayrımı için). */
      audio_track?: string
      headers?: Record<string, string>
    },
    signal?: AbortSignal,
  ): Promise<Response> => {
    let response: Response
    try {
      response = await fetch("/api/waveform/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
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
      let message = translate("api.httpFailed", { status: response.status })
      try {
        const data = (await response.json()) as { error?: string }
        if (data?.error) message = data.error
      } catch {
        /* gövde JSON değilse varsayılan mesaj kalır */
      }
      log(
        "error",
        translate("log.requestFailed", { path: "/api/waveform/stream" }),
        `HTTP ${response.status} — ${message}`,
      )
      throw new ApiError(message, response.status)
    }

    return response
  },

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
  getExportCapabilities: () => request<ExportCapabilities>("/api/export/capabilities"),
  /** Sayfa yenilendiğinde süren işleri geri yüklemek için. */
  listJobs: (activeOnly = false) =>
    request<JobsResponse>(
      `/api/jobs${activeOnly ? "?active=true" : ""}`,
      undefined,
      { silent: true },
    ),
  /** Panodaki işleri tek istekte yoklamak için (durumdan bağımsız). */
  listJobsByIds: (jobIds: string[]) =>
    request<JobsResponse>(
      `/api/jobs?ids=${encodeURIComponent(jobIds.join(","))}`,
      undefined,
      { silent: true },
    ),
  getJob: (jobId: string) => request<ExportJob>(`/api/jobs/${jobId}`),
  cancelJob: (jobId: string) =>
    post<{ success: boolean; message?: string }>(`/api/jobs/${jobId}/cancel`),

  listLibrary: () => request<{ files: ExportFile[] }>("/api/library"),
  getLibraryFileMeta: (name: string) =>
    request<LibraryFileMeta>(`/api/library/${encodeURIComponent(name)}/meta`),
  deleteLibraryFile: (name: string, options?: { silent?: boolean }) =>
    request<{ success: boolean; message?: string }>(
      `/api/library/${encodeURIComponent(name)}`,
      { method: "DELETE" },
      options,
    ),
  revealInExplorer: (filename?: string) =>
    post<{ success: boolean; message?: string }>(
      "/api/library/reveal",
      filename ? { filename } : {},
    ),
  /** Küçük kart önizlemesi; eksikse backend ilk istekte üretir. */
  libraryThumbnailUrl: (name: string, version?: string | number) => {
    const query =
      version === undefined ? "" : `?v=${encodeURIComponent(String(version))}`
    return `/api/library/${encodeURIComponent(name)}/thumbnail${query}`
  },

  /** Canlı kayıtlar: backend'de sürer, tarayıcı kapansa da devam eder. */
  recordings: (options?: { silent?: boolean }) =>
    request<{ recordings: Recording[] }>("/api/recordings", undefined, options),
  startRecording: (payload: StartRecordingRequest) =>
    post<Recording>("/api/recordings", payload),
  stopRecording: (id: string) => post<Recording>(`/api/recordings/${id}/stop`),
  /** Duraklat: akışa ekleme durur; `resume` kaldığı yerden devam eder. */
  pauseRecording: (id: string) => post<Recording>(`/api/recordings/${id}/pause`),
  resumeRecording: (id: string) => post<Recording>(`/api/recordings/${id}/resume`),
  deleteRecording: (id: string, options?: { silent?: boolean }) =>
    request<{ success: boolean }>(
      `/api/recordings/${id}`,
      { method: "DELETE" },
      options,
    ),

  /** Proje akışı: kayıtların ard arda eklendiği tek HLS akışı. */
  stream: (streamId: string, options?: { silent?: boolean }) =>
    request<StreamSummary>(
      `/api/streams/${encodeURIComponent(streamId)}`,
      undefined,
      options,
    ),
  /** Akıştaki tek bir kaydı (bloğu) siler; güncel özeti döner. */
  deleteStreamRecording: (
    streamId: string,
    recordingId: string,
    options?: { silent?: boolean },
  ) =>
    request<StreamSummary>(
      `/api/streams/${encodeURIComponent(streamId)}/recordings/${encodeURIComponent(recordingId)}`,
      { method: "DELETE" },
      options,
    ),
  /** Oynatma adresi: sürüm sorgusu önbelleği tazeler, yol değişmez. */
  streamUrl: (url: string, revision: number) =>
    revision > 0 ? `${url}?v=${revision}` : url,
}
