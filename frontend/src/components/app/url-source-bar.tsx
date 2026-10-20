/** Kaynak sekmesi: URL çözümleme (yt-dlp + HLS varyantı), yerel dosya ve ffprobe analizi. */
import { useMemo, useRef, useState } from "react"

import {
  ClipboardPaste,
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  Terminal,
  X,
} from "lucide-react"
import { toast } from "sonner"

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
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ApiError, api } from "@/lib/api"
import { parseCurl } from "@/lib/curl"
import { compactDuration, formatBytes, formatTime } from "@/lib/format"
import { extractPastedUrl, withScheme } from "@/lib/media"
import { useLocalImportStore } from "@/stores/local-import-store"
import { log } from "@/stores/log-store"
import { useStudioStore } from "@/stores/studio-store"

const DEMO_URL = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"

export function UrlSourceBar() {
  const inputUrl = useStudioStore((s) => s.inputUrl)
  const streamUrl = useStudioStore((s) => s.streamUrl)
  const title = useStudioStore((s) => s.title)
  const resolution = useStudioStore((s) => s.resolution)
  const platform = useStudioStore((s) => s.platform)
  const sourcePath = useStudioStore((s) => s.sourcePath)
  const audioUrl = useStudioStore((s) => s.audioUrl)
  const useProxy = useStudioStore((s) => s.useProxy)
  const meta = useStudioStore((s) => s.meta)
  const variants = useStudioStore((s) => s.variants)
  const previewHeight = useStudioStore((s) => s.previewHeight)
  const headers = useStudioStore((s) => s.headers)
  const appliedHeaderNames = headers ? Object.keys(headers) : []
  const appliedCookie = appliedHeaderNames.some((name) => name.toLowerCase() === "cookie")
  const defaultVariant = variants.find((item) => item.default) ?? variants[0] ?? null
  const setInputUrl = useStudioStore((s) => s.setInputUrl)
  const setUseProxy = useStudioStore((s) => s.setUseProxy)
  const setSource = useStudioStore((s) => s.setSource)
  const setPreviewHeight = useStudioStore((s) => s.setPreviewHeight)
  const setMeta = useStudioStore((s) => s.setMeta)
  const setSourceLoading = useStudioStore((s) => s.setSourceLoading)
  const clearSource = useStudioStore((s) => s.clearSource)

  const [resolving, setResolving] = useState(false)
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

  const platformLabel =
    platform === "youtube"
      ? "YouTube"
      : platform === "twitter"
        ? "X"
        : platform === "instagram"
          ? "Instagram"
          : platform === "local"
            ? "Yerel dosya"
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

    setResolving(true)
    setSourceLoading(true)
    log("info", `Kaynak çözümleniyor: ${url}`)
    try {
      const resolved = await api.resolve(url, requestedHeaders)
      const platform =
        resolved.platform ?? (resolved.is_youtube ? "youtube" : "direct")
      const effectiveHeaders = platform === "direct" ? requestedHeaders : null
      if (requestedHeaders && !effectiveHeaders) {
        log(
          "warn",
          "curl başlıkları yalnızca doğrudan medya bağlantılarında kullanılır.",
          "YouTube / X / Instagram için hesap çerezi kullanılmaz.",
        )
      }
      const PLATFORM_LABELS: Record<string, string> = {
        youtube: "YouTube",
        twitter: "X (Twitter)",
        instagram: "Instagram",
      }
      const label = PLATFORM_LABELS[platform]
      if (label) {
        log("info", `${label} linki tespit edildi, akış adresi alındı.`)
        // Harici platformların CDN'leri CORS başlığı göndermez → proxy gerekir.
        if (!useProxy) {
          setUseProxy(true)
          log("info", `${label} akışları CORS engelli: CORS proxy otomatik açıldı.`)
        }
      }
      if (effectiveHeaders) {
        const names = Object.keys(effectiveHeaders)
        const cookie = names.some((name) => name.toLowerCase() === "cookie")
        setUseProxy(true)
        log(
          "info",
          `${names.length} HTTP başlığı uygulanacak${cookie ? " (cookie dahil)" : ""}.`,
          names.join(", "),
        )
      }
      setInputUrl(url)
      setSource({
        streamUrl: resolved.stream_url,
        title: resolved.title ?? null,
        resolution: resolved.resolution ?? null,
        platform,
        audioUrl: resolved.audio_url ?? null,
        variants: resolved.variants ?? [],
        headers: effectiveHeaders,
        headerToken: resolved.header_token ?? null,
      })
      log(
        "success",
        `Kaynak hazır: ${resolved.title ?? resolved.stream_url}`,
        resolved.resolution ? `çözünürlük: ${resolved.resolution}` : undefined,
      )
      if (resolved.audio_url) {
        log(
          "info",
          "Bu akış yalnızca görüntü içeriyor; ses ayrı akıştan eşlenerek oynatılacak.",
          "Dışa aktarmada görüntü ve ses otomatik birleştirilir.",
        )
      }

      try {
        const probe = await api.probe(resolved.stream_url, effectiveHeaders)
        // Video elementinin bildirdiği boyut/süre korunur: ffprobe çok varyantlı
        // HLS'te yalnızca ilk varyantı görebilir. fps ise ffprobe'dan alınır.
        const existing = useStudioStore.getState().meta
        setMeta({
          width: existing?.width || probe.width,
          height: existing?.height || probe.height,
          duration: existing?.duration || probe.duration,
          hasAudio: probe.has_audio,
          fps: probe.fps > 0 ? probe.fps : undefined,
        })
        log(
          "success",
          "FFprobe analizi başarılı",
          `${probe.width}×${probe.height}, süre ${formatTime(probe.duration)}, ses: ${
            probe.has_audio ? "var" : "yok"
          }${probe.fps > 0 ? `, ${probe.fps} fps` : ""}`,
        )
      } catch (probeError) {
        const message =
          probeError instanceof Error ? probeError.message : "Analiz başarısız oldu."
        log("warn", "FFprobe analizi başarısız", message)
        toast.warning("Süre bilgisi alınamadı", { description: message })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof ApiError && error.status === 422) {
        log(
          "error",
          "yt-dlp bulunamadı: YouTube videoları için 'pip install -U yt-dlp' kurulumu gerekir.",
          message,
        )
        toast.error("yt-dlp bulunamadı", { description: message })
      } else {
        log("error", "Kaynak yüklenemedi", message)
        toast.error("Kaynak yüklenemedi", { description: message })
      }
    } finally {
      setResolving(false)
      setSourceLoading(false)
    }
  }

  /** Gelişmiş alandaki curl komutunu çözümleyip kaynağı yükler. */
  const handleCurlLoad = () => {
    const parsed = parseCurl(curlText)
    if (!parsed?.url) {
      toast.error("curl içinde bağlantı bulunamadı", {
        description: "Bağlantıyı tırnak içinde içeren curl komutunu yapıştır.",
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
    log("info", "Yerel kaynak yeni sekmede açıldı.")
  }

  /** Panodaki bağlantıyı tek tıkla giriş alanına aktarır. */
  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      const value = extractPastedUrl(text)
      if (!value) {
        toast.info("Panoda bağlantı yok", {
          description: "Önce bir video bağlantısı kopyala, sonra tekrar dene.",
        })
        return
      }
      setInputUrl(value)
      urlInputRef.current?.focus()
      log("info", "Bağlantı panodan yapıştırıldı.")
    } catch {
      toast.warning("Panoya erişilemedi", {
        description: "Tarayıcı izin vermediyse Ctrl+V ile yapıştırabilirsin.",
      })
    }
  }

  return (
    <>
      <div className="space-y-3">
        {/* Bağlantı girişi */}
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Input
              ref={urlInputRef}
              className="h-8 pr-8 text-xs"
              placeholder="Bağlantı yapıştır · YouTube / X / Instagram"
              aria-label="Video bağlantısı"
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
              className="absolute top-1/2 right-0.5 -translate-y-1/2 text-muted-foreground"
              onClick={() => void handlePasteFromClipboard()}
              disabled={resolving}
              title="Panodan yapıştır"
              aria-label="Panodan yapıştır"
            >
              <ClipboardPaste />
            </Button>
          </div>
          <Button
            className="shrink-0 px-3"
            onClick={() => void handleLoad()}
            disabled={!inputUrl.trim() || resolving}
          >
            {resolving ? <Loader2 className="animate-spin" /> : <Download />}
            {resolving ? "Çözümleniyor" : "Yükle"}
          </Button>
        </div>

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

        {picking || importing ? (
          <div className="space-y-1.5 rounded-xl border border-primary/25 bg-primary/5 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                <span className="truncate text-[11px]">
                  {picking
                    ? "Dosya seçiliyor…"
                    : importProcessing
                      ? "Tarayıcıya hazırlanıyor…"
                      : `Yükleniyor %${Math.round((importProgress ?? 0) * 100)}`}
                </span>
              </span>
              <Button
                variant="ghost"
                size="xs"
                className="h-6 shrink-0 text-[11px]"
                onClick={cancelImport}
              >
                <X />
                İptal
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
                Pencere açık; istediğin an iptal edebilirsin.
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 justify-center gap-1.5 px-2 text-xs font-normal"
              onClick={() => {
                if (nativeUnavailable) fileInputRef.current?.click()
                else void pickFile()
              }}
              disabled={resolving}
              title={
                nativeUnavailable
                  ? "Tarayıcıdan yükle (geçici kopya oluşturur)"
                  : "Kopyasız: dosya olduğu yerden okunur"
              }
            >
              <FolderOpen className="size-3.5" />
              Dosya seç
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 justify-center gap-1.5 px-2 text-xs font-normal"
              onClick={() => setAdvancedOpen(true)}
              disabled={resolving}
              title="Korumalı kaynaklar için curl komutu / HTTP başlıkları"
            >
              <Terminal className="size-3.5" />
              Curl / başlık
              {appliedHeaderNames.length > 0 && (
                <span className="rounded-full bg-primary/15 px-1.5 text-[9px] leading-4 font-semibold text-primary">
                  {appliedHeaderNames.length}
                </span>
              )}
            </Button>
          </div>
        )}

        {/* Aktif kaynak özeti */}
        {streamUrl && (
          <div className="overflow-hidden rounded-xl border border-border/70 bg-muted/20">
            <div className="flex items-start gap-2 p-2.5">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-xs font-medium" title={title ?? undefined}>
                  {title || "Kaynak"}
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
                  {meta && meta.duration > 0 && (
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
                      title="Bu kaynakta ses akışı yok; dalga formu çizilmez."
                    >
                      ses yok
                    </Badge>
                  )}
                  {appliedHeaderNames.length > 0 && (
                    <Badge
                      variant="outline"
                      className="h-[17px] px-1.5 text-[10px]"
                      title={appliedHeaderNames.join(", ")}
                    >
                      {appliedHeaderNames.length} başlık
                      {appliedCookie ? " · cookie" : ""}
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
                  log("info", "Kaynak temizlendi.")
                }}
                title="Kaynağı temizle"
                aria-label="Kaynağı temizle"
              >
                <X />
              </Button>
            </div>

            {variants.length > 1 && (
              <div className="flex items-center justify-between gap-2 border-t border-border/60 px-2.5 py-1.5">
                <span
                  className="text-[11px] text-muted-foreground"
                  title="Kalite yalnızca önizlemeyi etkiler; dışa aktarma 1080p'yi aşmayan en yüksek kaliteyi kullanır."
                >
                  Önizleme kalitesi
                </span>
                <Select
                  value={String(previewHeight ?? defaultVariant?.height ?? variants[0].height)}
                  onValueChange={(value) => {
                    const height = Number(value)
                    setPreviewHeight(height)
                    log("info", `Önizleme kalitesi: ${height}p.`)
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-[132px] text-xs tabular-nums"
                    aria-label="Önizleme kalitesi"
                    title="Oynatma kalitesi (dışa aktarma etkilenmez)"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" align="end" className="min-w-[148px]">
                    {variants.map((item) => (
                      <SelectItem
                        key={`${item.height}-${item.url}`}
                        value={String(item.height)}
                        className="text-xs tabular-nums"
                      >
                        {item.label}
                        {item.default ? " (önerilen)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {platform === "local" ? (
              <div className="flex items-center justify-between border-t border-border/60 px-2.5 py-1.5">
                <Button
                  variant="ghost"
                  size="xs"
                  className="-ml-1.5 h-6 px-1.5 text-[11px] font-normal text-muted-foreground"
                  onClick={handleOpenLocalInNewTab}
                  title="Dosyayı tarayıcının kendi oynatıcısıyla aç"
                >
                  <ExternalLink />
                  Yeni sekmede aç
                </Button>
                <span className="text-[10px] text-muted-foreground/70">
                  {sourcePath ? "kopyasız" : "geçici kopya"}
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between border-t border-border/60 px-2.5 py-1.5">
                <label
                  htmlFor="proxy-switch"
                  className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground"
                  title="CORS engelli kaynaklarda oynatma istekleri sunucu üzerinden geçer."
                >
                  CORS proxy
                </label>
                <Switch
                  id="proxy-switch"
                  checked={useProxy}
                  onCheckedChange={(checked) => {
                    setUseProxy(checked)
                    log("info", `CORS proxy ${checked ? "açıldı" : "kapatıldı"}.`)
                  }}
                />
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground/70">
            {!streamUrl ? "Sürükle-bırak da çalışır" : ""}
          </span>
          <Button
            variant="ghost"
            size="xs"
            className="-mr-1.5 h-6 px-1.5 text-[11px] font-normal text-muted-foreground"
            onClick={() => void handleLoad(DEMO_URL)}
            disabled={resolving}
          >
            Demo yayın
          </Button>
        </div>
      </div>

      {/* Gelişmiş: korumalı kaynaklar için curl (cookie / header) yapıştırma */}
      <Dialog open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Gelişmiş bağlantı</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              Korumalı kaynaklarda Chrome’da{" "}
              <span className="whitespace-nowrap font-medium text-foreground">
                Copy → Copy as cURL
              </span>{" "}
              ile kopyaladığın komutu yapıştır. Cookie, referer ve
              authorization başlıkları oynatma, analiz ve dışa aktarmada kullanılır.
            </DialogDescription>
          </DialogHeader>

          <textarea
            autoFocus
            value={curlText}
            onChange={(event) => setCurlText(event.target.value)}
            placeholder={
              "curl 'https://example.com/video.m3u8' \\\n  -H 'cookie: oturum=...' \\\n  -H 'referer: https://example.com/'"
            }
            spellCheck={false}
            rows={5}
            disabled={resolving}
            aria-label="curl komutu"
            className="min-h-28 w-full resize-y rounded-lg border border-input bg-transparent p-2.5 font-mono text-xs leading-relaxed outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
          />

          {curlText.trim() && (
            <div className="space-y-2">
              {parsedCurl?.url ? (
                <div className="rounded-lg border border-border/70 bg-muted/30 px-2 py-1.5">
                  <p
                    className="truncate font-mono text-[10px] text-muted-foreground"
                    title={parsedCurl.url}
                  >
                    {parsedCurl.url}
                  </p>
                </div>
              ) : (
                <p className="text-[10px] text-destructive">
                  Bağlantı bulunamadı — curl komutunu eksiksiz yapıştır.
                </p>
              )}
              {parsedCurl && Object.keys(parsedCurl.headers).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {Object.keys(parsedCurl.headers).map((name) => (
                    <Badge
                      key={name}
                      variant="secondary"
                      className="h-[18px] px-1.5 text-[10px]"
                    >
                      {name}
                    </Badge>
                  ))}
                </div>
              )}
              {parsedCurl?.warnings.map((warning) => (
                <p key={warning} className="text-[10px] text-amber-500">
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
              Temizle
            </Button>
            <Button
              type="button"
              onClick={handleCurlLoad}
              disabled={!parsedCurl?.url || resolving}
            >
              {resolving ? <Loader2 className="animate-spin" /> : <Terminal />}
              Bağlantıyı yükle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
