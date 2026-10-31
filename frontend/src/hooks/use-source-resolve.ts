/** Kaynak çözümleme: URL yükleme, ilerleme, iptal ve panodan yapıştırma.
 *
 * Ana sayfadaki üç tasarım da aynı akışı kullanır: bileşenler yalnızca görünümü
 * kurar, çözümleme/ffprobe/proxy kararları burada tek yerde kalır.
 */
import { useCallback, useEffect, useRef, useState } from "react"

import { toast } from "@/lib/notify"

import { ApiError, api } from "@/lib/api"
import { formatTime } from "@/lib/format"
import { extractPastedUrl, withScheme } from "@/lib/media"
import { useI18n } from "@/i18n"
import { log } from "@/stores/log-store"
import { useProjectUiStore } from "@/stores/project-ui-store"
import { useSessionSplashStore } from "@/stores/session-splash-store"
import { useSourceStore } from "@/stores/source-store"

export const DEMO_URL = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"

/** Typewriter'ın döndürdüğü örnek platformlar. */
export const TYPEWRITER_PHRASES = [
  "YouTube Clip",
  "X Clip",
  "Instagram Clip",
  "TikTok Clip",
  "Twitch Clip",
  "Facebook Clip",
]

export interface SourceResolve {
  inputUrl: string
  setInputUrl: (url: string) => void
  inputRef: React.RefObject<HTMLInputElement | null>
  resolving: boolean
  progress: number | null
  stage: string | null
  detail: string
  load: (
    overrideUrl?: string,
    headersOverride?: Record<string, string> | null,
  ) => Promise<void>
  cancel: () => void
  paste: () => Promise<void>
}

export function useSourceResolve(): SourceResolve {
  const { t } = useI18n()
  const inputUrl = useSourceStore((s) => s.inputUrl)
  const setInputUrl = useSourceStore((s) => s.setInputUrl)
  const setSource = useSourceStore((s) => s.setSource)
  const setMeta = useSourceStore((s) => s.setMeta)
  const setUseProxy = useSourceStore((s) => s.setUseProxy)
  const setSourceLoading = useSourceStore((s) => s.setSourceLoading)

  const inputRef = useRef<HTMLInputElement>(null)
  const resolveAbortRef = useRef<AbortController | null>(null)
  const [resolving, setResolving] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [stage, setStage] = useState<string | null>(null)
  const [detail, setDetail] = useState("")

  // Üst menüdeki "Yeni proje" ana sayfadaki kaynak alanına odaklanır.
  const sourceFocusNonce = useProjectUiStore((s) => s.sourceFocusNonce)
  useEffect(() => {
    if (sourceFocusNonce === 0) return
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [sourceFocusNonce])

  const cancel = useCallback(() => {
    if (resolveAbortRef.current) {
      resolveAbortRef.current.abort()
      resolveAbortRef.current = null
    }
    setResolving(false)
    setSourceLoading(false)
    setProgress(null)
    setStage(null)
    setDetail("")
    log("warn", t("source.resolveCancelled"))
    toast.info(t("source.resolveCancelled"))
  }, [setSourceLoading, t])

  const load = useCallback(
    async (
      overrideUrl?: string,
      headersOverride?: Record<string, string> | null,
    ) => {
      const url = withScheme(overrideUrl ?? useSourceStore.getState().inputUrl)
      if (!url || resolveAbortRef.current) return

      // curl'den gelen başlıklar yalnızca doğrudan medya kaynaklarına uygulanır;
      // yt-dlp platformlarında hesap güvenliği için çerez kullanılmaz.
      const requestedHeaders =
        headersOverride && Object.keys(headersOverride).length > 0
          ? headersOverride
          : null

      const controller = new AbortController()
      resolveAbortRef.current = controller
      setResolving(true)
      setSourceLoading(true)
      setProgress(0)
      setStage("resolving")
      setDetail("")
      const splashToken = useSessionSplashStore.getState().start({ cancel })
      log("info", t("log.sourceResolving", { url }))
      try {
        const resolved = await api.resolveStream(url, requestedHeaders, {
          onProgress: (event) => {
            if (event.percent !== undefined) {
              // İlerleme geriye sıçramasın (metadata/indirme geçişi).
              setProgress((previous) => Math.max(previous ?? 0, event.percent ?? 0))
            }
            if (event.stage) setStage(event.stage)
            if (event.detail !== undefined) setDetail(event.detail)
            useSessionSplashStore.getState().update({
              progress:
                event.percent === undefined
                  ? undefined
                  : Math.max(0, Math.min(100, event.percent)),
              stage: event.stage,
              detail: event.detail,
            })
          },
          signal: controller.signal,
        })

        const platform = resolved.platform ?? (resolved.is_youtube ? "youtube" : "direct")
        const effectiveHeaders = platform === "direct" ? requestedHeaders : null
        if (requestedHeaders && !effectiveHeaders) {
          log(
            "warn",
            t("log.curlHeadersDirectOnly"),
            t("log.noAccountCookies"),
          )
        }

        const label =
          platform === "youtube"
            ? t("source.platformYoutube")
            : platform === "twitter"
              ? t("source.platformX")
              : platform === "instagram"
                ? t("source.platformInstagram")
                : platform === "tiktok"
                  ? t("source.platformTiktok")
                  : platform === "ytdlp"
                    ? t("source.platformYtdlp")
                    : null
        if (label) {
          log("info", t("log.platformDetected", { platform: label }))
          // Harici platformların CDN'leri CORS başlığı göndermez → proxy gerekir.
          if (!useSourceStore.getState().useProxy) {
            setUseProxy(true)
            log("info", t("log.corsAutoEnabled", { platform: label }))
          }
        }
        if (effectiveHeaders) {
          const names = Object.keys(effectiveHeaders)
          const cookie = names.some((name) => name.toLowerCase() === "cookie")
          setUseProxy(true)
          log(
            "info",
            t("log.headersApplied", {
              count: names.length,
              cookie: cookie ? t("log.cookieIncluded") : "",
            }),
            names.join(", "),
          )
        }

        setInputUrl(url)
        setSource({
          streamUrl: resolved.stream_url,
          title: resolved.title ?? null,
          resolution: resolved.resolution ?? null,
          platform,
          originUrl: url,
          audioUrl: resolved.audio_url ?? null,
          audioTracks: resolved.audio_tracks ?? [],
          subtitleTracks: resolved.subtitle_tracks ?? [],
          variants: resolved.variants ?? [],
          isHls: Boolean(
            resolved.is_m3u8 || resolved.variants?.some((variant) => variant.hls),
          ),
          isLive: Boolean(resolved.is_live),
          headers: effectiveHeaders,
          headerToken: resolved.header_token ?? null,
        })
        log(
          "success",
          t("log.sourceReady", { title: resolved.title ?? resolved.stream_url }),
          resolved.resolution
            ? t("log.resolution", { resolution: resolved.resolution })
            : undefined,
        )
        if (resolved.audio_url) {
          log("info", t("log.audioSeparate"), t("log.audioMergedOnExport"))
        }

        if (resolved.is_live) {
          log("info", t("log.liveSource"), t("log.liveSourceHint"))
        } else {
          try {
            const probe = await api.probe(
              resolved.stream_url,
              effectiveHeaders,
              resolved.header_token,
            )
            // Video elementinin bildirdiği boyut/süre korunur: ffprobe çok varyantlı
            // HLS'te yalnızca ilk varyantı görebilir. fps ise ffprobe'dan alınır.
            const existing = useSourceStore.getState().meta
            setMeta({
              width: existing?.width || probe.width,
              height: existing?.height || probe.height,
              duration: existing?.duration || probe.duration,
              hasAudio: probe.has_audio,
              fps: probe.fps > 0 ? probe.fps : undefined,
            })
            log(
              "success",
              t("log.probeSuccess"),
              t("log.probeDetail", {
                width: probe.width,
                height: probe.height,
                duration: formatTime(probe.duration),
                audio: probe.has_audio
                  ? t("log.probeAudioYes")
                  : t("log.probeAudioNo"),
                fps: probe.fps > 0 ? `, ${probe.fps} fps` : "",
              }),
            )
          } catch (probeError) {
            const message =
              probeError instanceof Error
                ? probeError.message
                : t("log.probeFailedFallback")
            log("warn", t("log.probeFailed"), message)
            toast.warning(t("log.durationUnavailable"), { description: message })
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        if (error instanceof ApiError && error.status === 422) {
          log("error", t("log.ytdlpMissing"), message)
          toast.error(t("log.ytdlpMissing"), { description: message })
        } else {
          log("error", t("log.sourceLoadFailed"), message)
          toast.error(t("log.sourceLoadFailed"), { description: message })
        }
      } finally {
        resolveAbortRef.current = null
        setResolving(false)
        setSourceLoading(false)
        setProgress(null)
        setStage(null)
        setDetail("")
        useSessionSplashStore.getState().finish(splashToken)
      }
    },
    [cancel, setInputUrl, setMeta, setSource, setSourceLoading, setUseProxy, t],
  )

  /** Panodaki bağlantıyı tek tıkla giriş alanına aktarır. */
  const paste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      const value = extractPastedUrl(text)
      if (!value) {
        toast.info(t("log.clipboardEmpty"), {
          description: t("log.clipboardEmptyDesc"),
        })
        return
      }
      setInputUrl(value)
      inputRef.current?.focus()
      log("info", t("log.clipboardPasted"))
    } catch {
      toast.warning(t("log.clipboardDenied"), {
        description: t("log.clipboardDeniedDesc"),
      })
    }
  }, [setInputUrl, t])

  return {
    inputUrl,
    setInputUrl,
    inputRef,
    resolving,
    progress,
    stage,
    detail,
    load,
    cancel,
    paste,
  }
}
