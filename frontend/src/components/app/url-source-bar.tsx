/** Kaynak sekmesi: URL çözümleme (yt-dlp + HLS varyantı), yerel dosya ve ffprobe analizi. */
import { useEffect, useMemo, useRef, useState } from "react"

import {
  ClipboardPaste,
  Download,
  EllipsisVertical,
  ExternalLink,
  FilePlus2,
  FolderOpen,
  Loader2,
  Terminal,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { useProjectWorkspaceController } from "@/components/app/project-workspace-context"
import { TypewriterPlaceholder } from "@/components/app/typewriter-placeholder"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { ApiError, api } from "@/lib/api"
import { parseCurl } from "@/lib/curl"
import { compactDuration, formatBytes, formatTime } from "@/lib/format"
import { extractPastedUrl, withScheme } from "@/lib/media"
import { useI18n } from "@/i18n"
import { useLocalImportStore } from "@/stores/local-import-store"
import { log } from "@/stores/log-store"
import { useProjectUiStore } from "@/stores/project-ui-store"
import { useSourceStore } from "@/stores/source-store"
import { cn } from "cn"

const DEMO_URL = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"

const TYPEWRITER_PHRASES = [
  "YouTube Clip",
  "X Clip",
  "Instagram Clip",
  "TikTok Clip",
  "Twitch Clip",
  "Facebook Clip",
]

function CircleProgress({ percent }: { percent: number }) {
  const radius = 14
  const circumference = 2 * Math.PI * radius
  const clamped = Math.min(100, Math.max(0, percent))
  const offset = circumference - (clamped / 100) * circumference

  return (
    <div className="relative flex size-10 shrink-0 items-center justify-center">
      <svg className="size-full -rotate-90" viewBox="0 0 36 36">
        <circle
          cx="18"
          cy="18"
          r={radius}
          className="stroke-muted/30"
          strokeWidth="3.5"
          fill="none"
        />
        <circle
          cx="18"
          cy="18"
          r={radius}
          className="stroke-primary transition-[stroke-dashoffset] duration-200"
          strokeWidth="3.5"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      <span className="absolute font-mono text-[9px] font-bold tracking-tight text-foreground">
        {Math.round(clamped)}%
      </span>
    </div>
  )
}

export function UrlSourceBar({
  variant = "default",
}: {
  variant?: "default" | "hero"
}) {
  const { t } = useI18n()
  const project = useProjectWorkspaceController()
  const inputUrl = useSourceStore((s) => s.inputUrl)
  const streamUrl = useSourceStore((s) => s.streamUrl)
  const title = useSourceStore((s) => s.title)
  const resolution = useSourceStore((s) => s.resolution)
  const platform = useSourceStore((s) => s.platform)
  const sourcePath = useSourceStore((s) => s.sourcePath)
  const previewCopy = useSourceStore((s) => s.previewCopy)
  const audioUrl = useSourceStore((s) => s.audioUrl)
  const useProxy = useSourceStore((s) => s.useProxy)
  const meta = useSourceStore((s) => s.meta)
  const isLive = useSourceStore((s) => s.isLive)
  const headers = useSourceStore((s) => s.headers)
  const appliedHeaderNames = headers ? Object.keys(headers) : []
  const appliedCookie = appliedHeaderNames.some((name) => name.toLowerCase() === "cookie")
  const setInputUrl = useSourceStore((s) => s.setInputUrl)
  const setUseProxy = useSourceStore((s) => s.setUseProxy)
  const setSource = useSourceStore((s) => s.setSource)
  const setMeta = useSourceStore((s) => s.setMeta)
  const setSourceLoading = useSourceStore((s) => s.setSourceLoading)
  const clearSource = useSourceStore((s) => s.clearSource)

  const [resolving, setResolving] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)
  const [resolveProgress, setResolveProgress] = useState<number | null>(null)
  const [resolveStage, setResolveStage] = useState<string | null>(null)
  const [resolveDetail, setResolveDetail] = useState<string>("")
  const resolveAbortRef = useRef<AbortController | null>(null)

  const handleCancelResolve = () => {
    if (resolveAbortRef.current) {
      resolveAbortRef.current.abort()
      resolveAbortRef.current = null
    }
    setResolving(false)
    setSourceLoading(false)
    setResolveProgress(null)
    setResolveStage(null)
    setResolveDetail("")
    log("warn", t("source.resolveCancelled"))
    toast.info(t("source.resolveCancelled"))
  }

  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [curlText, setCurlText] = useState("")
  const parsedCurl = useMemo(() => parseCurl(curlText), [curlText])
  const urlInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const importing = useLocalImportStore((s) => s.busy)
  const picking = useLocalImportStore((s) => s.picking)
  const nativeUnavailable = useLocalImportStore((s) => s.nativeUnavailable)
  const importProgress = useLocalImportStore((s) => s.progress)
  const importProcessing = useLocalImportStore((s) => s.processing)
  const importingFileName = useLocalImportStore((s) => s.fileName)
  const importFileSize = useLocalImportStore((s) => s.fileSize)
  const importFile = useLocalImportStore((s) => s.importFile)
  const pickFile = useLocalImportStore((s) => s.pickFile)
  const cancelImport = useLocalImportStore((s) => s.cancel)

  // Üst menüdeki "Yeni proje" kaynak alanına odaklanır (ana sayfa yeni açıldıysa da).
  const sourceFocusNonce = useProjectUiStore((s) => s.sourceFocusNonce)
  useEffect(() => {
    if (sourceFocusNonce === 0) return
    const input = urlInputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [sourceFocusNonce])

  const platformLabel =
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
              : platform === "local"
                ? t("source.platformLocal")
                : null

  const handleLoad = async (
    overrideUrl?: string,
    headersOverride?: Record<string, string> | null,
  ) => {
    const url = withScheme(overrideUrl ?? inputUrl)
    if (!url || resolving) return

    // curl'den gelen başlıklar yalnızca doğrudan medya kaynaklarına uygulanır;
    // yt-dlp platformlarında hesap güvenliği için çerez kullanılmaz.
    const requestedHeaders =
      headersOverride && Object.keys(headersOverride).length > 0 ? headersOverride : null

    const controller = new AbortController()
    resolveAbortRef.current = controller
    setResolving(true)
    setSourceLoading(true)
    setResolveProgress(0)
    setResolveStage("resolving")
    setResolveDetail("")
    log("info", t("log.sourceResolving", { url }))
    try {
      const resolved = await api.resolveStream(url, requestedHeaders, {
        onProgress: (event) => {
          if (event.percent !== undefined) {
            // İlerleme geriye sıçramasın (metadata/indirme geçişi).
            setResolveProgress((previous) =>
              Math.max(previous ?? 0, event.percent ?? 0),
            )
          }
          if (event.stage) setResolveStage(event.stage)
          if (event.detail !== undefined) setResolveDetail(event.detail)
        },
        signal: controller.signal,
      })
      const platform =
        resolved.platform ?? (resolved.is_youtube ? "youtube" : "direct")
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
        if (!useProxy) {
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
        resolved.resolution ? t("log.resolution", { resolution: resolved.resolution }) : undefined,
      )
      if (resolved.audio_url) {
        log(
          "info",
          t("log.audioSeparate"),
          t("log.audioMergedOnExport"),
        )
      }

      if (resolved.is_live) {
        log("info", t("log.liveSource"), t("log.liveSourceHint"))
      } else {
        try {
          const probe = await api.probe(resolved.stream_url, effectiveHeaders, resolved.header_token)
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
              audio: probe.has_audio ? t("log.probeAudioYes") : t("log.probeAudioNo"),
              fps: probe.fps > 0 ? `, ${probe.fps} fps` : "",
            }),
          )
        } catch (probeError) {
          const message =
            probeError instanceof Error ? probeError.message : t("log.probeFailedFallback")
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
        log(
          "error",
          t("log.ytdlpMissing"),
          message,
        )
        toast.error(t("log.ytdlpMissing"), { description: message })
      } else {
        log("error", t("log.sourceLoadFailed"), message)
        toast.error(t("log.sourceLoadFailed"), { description: message })
      }
    } finally {
      resolveAbortRef.current = null
      setResolving(false)
      setSourceLoading(false)
      setResolveProgress(null)
      setResolveStage(null)
      setResolveDetail("")
    }
  }

  /** Gelişmiş alandaki curl komutunu çözümleyip kaynağı yükler. */
  const handleCurlLoad = () => {
    const parsed = parseCurl(curlText)
    if (!parsed?.url) {
      toast.error(t("log.curlNoUrl"), {
        description: t("log.curlNoUrlDesc"),
      })
      return
    }
    setInputUrl(parsed.url)
    setAdvancedOpen(false)
    void handleLoad(parsed.url, parsed.headers)
  }

  /** Yerel kaynağı tarayıcının kendi oynatıcısıyla yeni sekmede açar. */
  const handleOpenLocalInNewTab = () => {
    if (!streamUrl) return
    window.open(streamUrl, "_blank", "noopener,noreferrer")
    log("info", t("log.localNewTab"))
  }

  /** Panodaki bağlantıyı tek tıkla giriş alanına aktarır. */
  const handlePasteFromClipboard = async () => {
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
      urlInputRef.current?.focus()
      log("info", t("log.clipboardPasted"))
    } catch {
      toast.warning(t("log.clipboardDenied"), {
        description: t("log.clipboardDeniedDesc"),
      })
    }
  }

  const sourceMenuContent = (
    <DropdownMenuContent align="end" className="min-w-[11rem]">
      <DropdownMenuItem
        onSelect={() => void pickFile()}
        title={t("source.pickFileNativeTitle")}
      >
        <FolderOpen />
        {t("source.pickFile")}
      </DropdownMenuItem>
      {nativeUnavailable && (
        <DropdownMenuItem
          onSelect={() => fileInputRef.current?.click()}
          title={t("source.pickFileBrowserTitle")}
        >
          <FilePlus2 />
          <span className="min-w-0 truncate">{t("source.pickFileBrowser")}</span>
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={() => setAdvancedOpen(true)}
        title={t("source.curlTitle")}
      >
        <Terminal />
        <span className="min-w-0 truncate">{t("source.curl")}</span>
        {appliedHeaderNames.length > 0 && (
          <span className="ml-auto rounded-full bg-primary/15 px-1.5 text-[9px] leading-4 font-semibold text-primary">
            {appliedHeaderNames.length}
          </span>
        )}
      </DropdownMenuItem>
    </DropdownMenuContent>
  )

  return (
    <>
      <div className={cn("space-y-3", variant === "hero" && "space-y-4")}>
        {/* Bağlantı girişi */}
        {variant === "hero" ? (
          <>
            <div className="relative">
              <Input
                ref={urlInputRef}
                type="search"
                className={cn(
                  "h-16 border-0 bg-transparent px-0 text-2xl font-medium shadow-none focus-visible:border-0 focus-visible:ring-0 sm:h-20 sm:text-4xl dark:bg-transparent",
                  inputUrl || inputFocused ? "text-left" : "text-center",
                )}
                placeholder=""
                aria-label={t("source.urlAria")}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                value={inputUrl}
                onChange={(event) => setInputUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleLoad()
                }}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                disabled={resolving}
              />
              {!inputUrl && !inputFocused && !resolving && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
                >
                  <TypewriterPlaceholder
                    phrases={TYPEWRITER_PHRASES}
                    className="max-w-full truncate text-2xl font-medium text-muted-foreground/70 sm:text-4xl"
                  />
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                className="h-11 shrink-0 rounded-full px-6 text-sm"
                onClick={() => void handleLoad()}
                disabled={!inputUrl.trim() || resolving}
              >
                {resolving ? <Loader2 className="animate-spin" /> : <Download />}
                {resolving ? t("source.resolving") : t("source.load")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-11 rounded-full px-4 text-sm text-muted-foreground"
                onClick={() => void handlePasteFromClipboard()}
                disabled={resolving}
                title={t("source.paste")}
                aria-label={t("source.paste")}
              >
                <ClipboardPaste />
                {t("source.paste")}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0 rounded-full text-muted-foreground"
                    disabled={resolving}
                    title={t("source.actions")}
                    aria-label={t("source.actions")}
                  >
                    <EllipsisVertical />
                  </Button>
                </DropdownMenuTrigger>
                {sourceMenuContent}
              </DropdownMenu>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-1.5">
            <div className="relative min-w-0 flex-1">
              <Input
                ref={urlInputRef}
                type="search"
                className="h-10 pr-14 text-sm"
                placeholder={t("source.urlPlaceholder")}
                aria-label={t("source.urlAria")}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                value={inputUrl}
                onChange={(event) => setInputUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleLoad()
                }}
                disabled={resolving}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="absolute top-1/2 right-6 -translate-y-1/2 text-muted-foreground"
                onClick={() => void handlePasteFromClipboard()}
                disabled={resolving}
                title={t("source.paste")}
                aria-label={t("source.paste")}
              >
                <ClipboardPaste />
              </Button>
            </div>
            <Button
              className="h-10 shrink-0 px-4 text-sm"
              onClick={() => void handleLoad()}
              disabled={!inputUrl.trim() || resolving}
            >
              {resolving ? <Loader2 className="animate-spin" /> : <Download />}
              {resolving ? t("source.resolving") : t("source.load")}
            </Button>

            {/* Yerel dosya ve curl/başlık işlemleri yer kaplamasın diye menüde. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-10 shrink-0"
                  disabled={resolving}
                  title={t("source.actions")}
                  aria-label={t("source.actions")}
                >
                  <EllipsisVertical />
                </Button>
              </DropdownMenuTrigger>
              {sourceMenuContent}
            </DropdownMenu>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,.mkv,.m4v,.ts,.mov,.avi,.flv,.wmv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ""
            if (file) void importFile(file)
          }}
        />

        {resolving && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-2.5 shadow-xs">
            <div className="flex min-w-0 items-center gap-3">
              <CircleProgress percent={resolveProgress ?? 0} />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="truncate text-xs font-semibold text-foreground">
                  {resolveStage === "downloading"
                    ? t("source.downloadingTiktok")
                    : resolveStage === "transcoding"
                      ? t("source.preparingBrowser")
                      : t("source.resolving")}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {resolveDetail || (resolveStage === "resolving" ? t("source.examiningLink") : resolveStage === "transcoding" ? t("source.preparingBrowser") : t("source.downloadingTiktok"))}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="h-7 shrink-0 gap-1 border-destructive/30 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={handleCancelResolve}
              title={t("source.cancelDownload")}
            >
              <X className="size-3" />
              {t("common.cancel")}
            </Button>
          </div>
        )}

        {(picking || importing) && (
          <div className="space-y-1.5 rounded-xl border border-primary/25 bg-primary/5 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                <span className="truncate text-[11px]">
                  {picking
                    ? t("source.picking")
                    : importProcessing
                      ? t("source.preparingBrowser")
                      : t("source.uploading", {
                          percent: Math.round((importProgress ?? 0) * 100),
                        })}
                </span>
              </span>
              <Button
                variant="ghost"
                size="xs"
                className="h-6 shrink-0 text-[11px]"
                onClick={cancelImport}
              >
                <X />
                {t("common.cancel")}
              </Button>
            </div>
            {!picking && (
              <>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-150"
                    style={{ width: `${Math.round((importProgress ?? 0) * 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <span className="truncate">{importingFileName}</span>
                  {importFileSize !== null && importFileSize > 0 && (
                    <span className="shrink-0 tabular-nums">
                      {importProcessing
                        ? formatBytes(importFileSize)
                        : `${formatBytes(importFileSize * (importProgress ?? 0))} / ${formatBytes(importFileSize)}`}
                    </span>
                  )}
                </div>
              </>
            )}
            {picking && (
              <p className="text-[10px] text-muted-foreground">
                {t("source.pickWindowOpen")}
              </p>
            )}
          </div>
        )}

        {/* Aktif kaynak özeti */}
        {streamUrl && (
          <div className="overflow-hidden rounded-xl border border-border/70 bg-muted/20">
            <div className="flex items-start gap-2 p-2.5">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-xs font-medium" title={title ?? undefined}>
                  {title || t("source.source")}
                </p>
                <div className="flex flex-wrap items-center gap-1">
                  {platformLabel && (
                    <Badge
                      variant="secondary"
                      className="h-[17px] px-1.5 text-[10px]"
                    >
                      {platformLabel}
                    </Badge>
                  )}
                  {resolution && (
                    <Badge
                      variant="secondary"
                      className="h-[17px] px-1.5 text-[10px]"
                    >
                      {resolution}
                    </Badge>
                  )}
                  {!isLive && meta && meta.duration > 0 && (
                    <Badge
                      variant="outline"
                      className="h-[17px] px-1.5 text-[10px] tabular-nums"
                    >
                      {compactDuration(meta.duration)}
                    </Badge>
                  )}
                  {meta && !meta.hasAudio && !audioUrl && (
                    <Badge
                      variant="outline"
                      className="h-[17px] border-amber-500/30 px-1.5 text-[10px] text-amber-600 dark:text-amber-400"
                      title={t("source.noAudioTitle")}
                    >
                      {t("source.noAudio")}
                    </Badge>
                  )}
                  {appliedHeaderNames.length > 0 && (
                    <Badge
                      variant="outline"
                      className="h-[17px] px-1.5 text-[10px]"
                      title={appliedHeaderNames.join(", ")}
                    >
                      {t("source.headers", { count: appliedHeaderNames.length })}
                      {appliedCookie ? ` · ${t("source.cookie")}` : ""}
                    </Badge>
                  )}
                </div>
                <p
                  className="truncate font-mono text-[10px] leading-relaxed text-muted-foreground"
                  title={sourcePath ?? streamUrl}
                >
                  {sourcePath ?? streamUrl}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                className="-mt-0.5 -mr-0.5 shrink-0 text-muted-foreground"
                onClick={() => {
                  clearSource()
                  log("info", t("log.sourceCleared"))
                }}
                title={t("source.clearSource")}
                aria-label={t("source.clearSource")}
              >
                <X />
              </Button>
            </div>

            {platform === "local" ? (
              <div className="flex items-center justify-between border-t border-border/60 px-2.5 py-1.5">
                <Button
                  variant="ghost"
                  size="xs"
                  className="-ml-1.5 h-6 px-1.5 text-[11px] font-normal text-muted-foreground"
                  onClick={handleOpenLocalInNewTab}
                  title={t("source.openNewTabTitle")}
                >
                  <ExternalLink />
                  {t("source.openNewTab")}
                </Button>
                <span className="text-[10px] text-muted-foreground/70">
                  {sourcePath && !previewCopy ? t("source.noCopy") : t("source.tempCopy")}
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between border-t border-border/60 px-2.5 py-1.5">
                <label
                  htmlFor="proxy-switch"
                  className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground"
                  title={t("source.corsProxyTitle")}
                >
                  {t("source.corsProxy")}
                </label>
                <Switch
                  id="proxy-switch"
                  checked={useProxy}
                  onCheckedChange={(checked) => {
                    setUseProxy(checked)
                    log("info", t(checked ? "log.proxyEnabled" : "log.proxyDisabled"))
                  }}
                />
              </div>
            )}
          </div>
        )}

        <div
          className={cn(
            "flex items-center gap-2",
            variant === "hero" ? "justify-center" : "justify-between",
          )}
        >
          <span className="truncate text-[11px] text-muted-foreground/70">
            {!streamUrl ? t("source.dragDropHint") : ""}
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            {(project.projectId || streamUrl) && (
              <Button
                variant="ghost"
                size="xs"
                className="-ml-1.5 h-6 px-1.5 text-[11px] font-normal text-muted-foreground"
                onClick={project.startFresh}
                disabled={resolving}
                title={t("project.newProjectTitle")}
                aria-label={t("project.newProject")}
              >
                <FilePlus2 />
                {t("project.newProject")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="xs"
              className="-mr-1.5 h-6 px-1.5 text-[11px] font-normal text-muted-foreground"
              onClick={() => void handleLoad(DEMO_URL)}
              disabled={resolving}
            >
              {t("source.demo")}
            </Button>
          </div>
        </div>
      </div>
      {/* Gelişmiş: korumalı kaynaklar için curl (cookie / header) yapıştırma */}
      <Dialog open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <DialogContent className="grid-cols-1 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("source.advancedTitle")}</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              {t("source.advancedDescription")}
            </DialogDescription>
          </DialogHeader>

          <textarea
            autoFocus
            wrap="soft"
            value={curlText}
            onChange={(event) => setCurlText(event.target.value)}
            placeholder={
              "curl 'https://example.com/video.m3u8' \\\n  -H 'cookie: oturum=...' \\\n  -H 'referer: https://example.com/'"
            }
            spellCheck={false}
            rows={5}
            disabled={resolving}
            aria-label={t("source.curlAria")}
            className="block max-h-64 min-h-28 w-full max-w-full min-w-0 resize-y overflow-y-auto rounded-lg border border-input bg-transparent p-2.5 font-mono text-xs leading-relaxed wrap-anywhere whitespace-pre-wrap outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
          />

          {curlText.trim() && (
            <div className="min-w-0 max-w-full space-y-2">
              {parsedCurl?.url ? (
                <div className="min-w-0 max-w-full rounded-lg border border-border/70 bg-muted/30 px-2 py-1.5">
                  <p
                    className="min-w-0 truncate font-mono text-[10px] text-muted-foreground"
                    title={parsedCurl.url}
                  >
                    {parsedCurl.url}
                  </p>
                </div>
              ) : (
                <p className="text-[10px] text-destructive">
                  {t("source.noUrlFound")}
                </p>
              )}
              {parsedCurl && Object.keys(parsedCurl.headers).length > 0 && (
                <div className="flex min-w-0 max-w-full flex-wrap gap-1">
                  {Object.keys(parsedCurl.headers).map((name) => (
                    <Badge
                      key={name}
                      variant="secondary"
                      className="h-auto min-h-[18px] max-w-full min-w-0 px-1.5 text-[10px] whitespace-normal wrap-anywhere"
                    >
                      {name}
                    </Badge>
                  ))}
                </div>
              )}
              {parsedCurl?.warnings.map((warning) => (
                <p
                  key={warning}
                  className="min-w-0 text-[10px] text-amber-500 wrap-anywhere"
                >
                  {warning}
                </p>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCurlText("")}
              disabled={!curlText || resolving}
            >
              {t("common.clear")}
            </Button>
            <Button
              type="button"
              onClick={handleCurlLoad}
              disabled={!parsedCurl?.url || resolving}
            >
              {resolving ? <Loader2 className="animate-spin" /> : <Terminal />}
              {t("source.loadUrl")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
