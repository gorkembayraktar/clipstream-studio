/** Kaynak durumu parçaları: çözümleme/aktarma ilerlemesi, kaynak özeti ve curl penceresi.
 *
 * Ana sayfadaki üç tasarım da bu parçaları paylaşır; görünüm farkı yalnızca
 * sayfa düzeninde ve animasyonlarda kalır.
 */
import { useState } from "react"

import {
  ChevronDown,
  ExternalLink,
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
import { Switch } from "@/components/ui/switch"
import { useI18n } from "@/i18n"
import { parseCurl } from "@/lib/curl"
import { compactDuration, formatBytes } from "@/lib/format"
import type { SourcePlatform } from "@/lib/types"
import { log } from "@/stores/log-store"
import { useLocalImportStore } from "@/stores/local-import-store"
import { useSourceStore } from "@/stores/source-store"
import { cn } from "cn"

type Translate = ReturnType<typeof useI18n>["t"]

function platformLabel(platform: SourcePlatform, t: Translate): string | null {
  switch (platform) {
    case "youtube":
      return t("source.platformYoutube")
    case "twitter":
      return t("source.platformX")
    case "instagram":
      return t("source.platformInstagram")
    case "tiktok":
      return t("source.platformTiktok")
    case "ytdlp":
      return t("source.platformYtdlp")
    case "local":
      return t("source.platformLocal")
    default:
      return null
  }
}

export function CircleProgress({ percent }: { percent: number }) {
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

/** URL çözümlemesi sürerken gösterilen ilerleme şeridi. */
export function ResolveProgressCard({
  progress,
  stage,
  detail,
  onCancel,
  className,
}: {
  progress: number | null
  stage: string | null
  detail: string
  onCancel: () => void
  className?: string
}) {
  const { t } = useI18n()

  return (
    <div
      data-slot="resolve-progress"
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-2.5 shadow-xs",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <CircleProgress percent={progress ?? 0} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate text-xs font-semibold text-foreground">
            {stage === "downloading"
              ? t("source.downloadingTiktok")
              : stage === "transcoding"
                ? t("source.preparingBrowser")
                : t("source.resolving")}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {detail ||
              (stage === "resolving"
                ? t("source.examiningLink")
                : stage === "transcoding"
                  ? t("source.preparingBrowser")
                  : t("source.downloadingTiktok"))}
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="h-7 shrink-0 gap-1 border-destructive/30 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={onCancel}
        title={t("source.cancelDownload")}
      >
        <X className="size-3" />
        {t("common.cancel")}
      </Button>
    </div>
  )
}

/** Yerel dosya aktarımı / hazırlığı sürerken gösterilen ilerleme. */
export function ImportProgressCard({ className }: { className?: string }) {
  const { t } = useI18n()
  const picking = useLocalImportStore((s) => s.picking)
  const busy = useLocalImportStore((s) => s.busy)
  const progress = useLocalImportStore((s) => s.progress)
  const processing = useLocalImportStore((s) => s.processing)
  const fileName = useLocalImportStore((s) => s.fileName)
  const fileSize = useLocalImportStore((s) => s.fileSize)
  const cancel = useLocalImportStore((s) => s.cancel)

  if (!picking && !busy) return null

  return (
    <div
      data-slot="import-progress"
      className={cn(
        "space-y-1.5 rounded-xl border border-primary/25 bg-primary/5 p-2.5",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
          <span className="truncate text-[11px]">
            {picking
              ? t("source.picking")
              : processing
                ? t("source.preparingBrowser")
                : t("source.uploading", {
                    percent: Math.round((progress ?? 0) * 100),
                  })}
          </span>
        </span>
        <Button
          variant="ghost"
          size="xs"
          className="h-6 shrink-0 text-[11px]"
          onClick={cancel}
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
              style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span className="truncate">{fileName}</span>
            {fileSize !== null && fileSize > 0 && (
              <span className="shrink-0 tabular-nums">
                {processing
                  ? formatBytes(fileSize)
                  : `${formatBytes(fileSize * (progress ?? 0))} / ${formatBytes(fileSize)}`}
              </span>
            )}
          </div>
        </>
      )}
      {picking && (
        <p className="text-[10px] text-muted-foreground">{t("source.pickWindowOpen")}</p>
      )}
    </div>
  )
}

/** Çözümlenmiş kaynağın kısa özeti (başlık, rozetler, yol, proxy). */
export function SourceSummaryCard({
  className,
  collapsible = false,
}: {
  className?: string
  /** Uzun yolu varsayılan olarak gizle (terminal tasarımı). */
  collapsible?: boolean
}) {
  const { t } = useI18n()
  const streamUrl = useSourceStore((s) => s.streamUrl)
  const title = useSourceStore((s) => s.title)
  const resolution = useSourceStore((s) => s.resolution)
  const platform = useSourceStore((s) => s.platform)
  const sourcePath = useSourceStore((s) => s.sourcePath)
  const previewCopy = useSourceStore((s) => s.previewCopy)
  const useProxy = useSourceStore((s) => s.useProxy)
  const meta = useSourceStore((s) => s.meta)
  const isLive = useSourceStore((s) => s.isLive)
  const headers = useSourceStore((s) => s.headers)
  const setUseProxy = useSourceStore((s) => s.setUseProxy)
  const clearSource = useSourceStore((s) => s.clearSource)
  const [parked, setParked] = useState(collapsible)

  if (!streamUrl) return null

  const headerNames = headers ? Object.keys(headers) : []
  const cookie = headerNames.some((name) => name.toLowerCase() === "cookie")
  const label = platformLabel(platform, t)

  return (
    <div
      data-slot="source-summary"
      className={cn(
        "overflow-hidden rounded-xl border border-border/70 bg-muted/20",
        className,
      )}
    >
      <div className="flex items-start gap-2 p-2.5">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-xs font-medium" title={title ?? undefined}>
            {title || t("source.source")}
          </p>
          <div className="flex flex-wrap items-center gap-1">
            {label && (
              <Badge variant="secondary" className="h-[17px] px-1.5 text-[10px]">
                {label}
              </Badge>
            )}
            {resolution && (
              <Badge variant="secondary" className="h-[17px] px-1.5 text-[10px]">
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
            {meta && !meta.hasAudio && (
              <Badge
                variant="outline"
                className="h-[17px] border-amber-500/30 px-1.5 text-[10px] text-amber-600 dark:text-amber-400"
                title={t("source.noAudioTitle")}
              >
                {t("source.noAudio")}
              </Badge>
            )}
            {headerNames.length > 0 && (
              <Badge
                variant="outline"
                className="h-[17px] px-1.5 text-[10px]"
                title={headerNames.join(", ")}
              >
                {t("source.headers", { count: headerNames.length })}
                {cookie ? ` · ${t("source.cookie")}` : ""}
              </Badge>
            )}
          </div>
          {!parked && (
            <p
              className="truncate font-mono text-[10px] leading-relaxed text-muted-foreground"
              title={sourcePath ?? streamUrl}
            >
              {sourcePath ?? streamUrl}
            </p>
          )}
        </div>
        {collapsible && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="-mt-0.5 shrink-0 text-muted-foreground"
            onClick={() => setParked((value) => !value)}
            title={t("source.source")}
            aria-label={t("source.source")}
            aria-expanded={!parked}
          >
            <ChevronDown className={cn("transition-transform", parked && "-rotate-90")} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn(
            "-mt-0.5 -mr-0.5 shrink-0 text-muted-foreground",
            collapsible && "-mt-0.5",
          )}
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
            onClick={() => {
              window.open(streamUrl, "_blank", "noopener,noreferrer")
              log("info", t("log.localNewTab"))
            }}
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
  )
}

/** Korumalı kaynaklar için curl komutu (cookie / header) penceresi. */
export function SourceCurlDialog({
  open,
  onOpenChange,
  onSubmit,
  disabled = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (url: string, headers: Record<string, string>) => void
  disabled?: boolean
}) {
  const { t } = useI18n()
  const [curlText, setCurlText] = useState("")
  const parsed = parseCurl(curlText)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          disabled={disabled}
          aria-label={t("source.curlAria")}
          className="block max-h-64 min-h-28 w-full max-w-full min-w-0 resize-y overflow-y-auto rounded-lg border border-input bg-transparent p-2.5 font-mono text-xs leading-relaxed wrap-anywhere whitespace-pre-wrap outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
        />

        {curlText.trim() && (
          <div className="min-w-0 max-w-full space-y-2">
            {parsed?.url ? (
              <div className="min-w-0 max-w-full rounded-lg border border-border/70 bg-muted/30 px-2 py-1.5">
                <p
                  className="min-w-0 truncate font-mono text-[10px] text-muted-foreground"
                  title={parsed.url}
                >
                  {parsed.url}
                </p>
              </div>
            ) : (
              <p className="text-[10px] text-destructive">{t("source.noUrlFound")}</p>
            )}
            {parsed && Object.keys(parsed.headers).length > 0 && (
              <div className="flex min-w-0 max-w-full flex-wrap gap-1">
                {Object.keys(parsed.headers).map((name) => (
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
            {parsed?.warnings.map((warning) => (
              <p key={warning} className="min-w-0 text-[10px] text-amber-500 wrap-anywhere">
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
            disabled={!curlText || disabled}
          >
            {t("common.clear")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (!parsed?.url) {
                toast.error(t("log.curlNoUrl"), {
                  description: t("log.curlNoUrlDesc"),
                })
                return
              }
              onOpenChange(false)
              onSubmit(parsed.url, parsed.headers)
            }}
            disabled={!parsed?.url || disabled}
          >
            {disabled ? <Loader2 className="animate-spin" /> : <Terminal />}
            {t("source.loadUrl")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
