/** Dışa aktarma sekmesi: seçili aralık, çıktı ayarları, seçenekler ve işler. */
import { DownloadIcon, Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useStartExport } from "@/hooks/use-export-job"
import { useGpuCapability } from "@/hooks/use-gpu-capability"
import { useI18n, type TranslationKey } from "@/i18n"
import { compactDuration, formatTime } from "@/lib/format"
import type {
  CropPayload,
  CutMode,
  ExportQuality,
  OutputFormat,
} from "@/lib/types"
import { log } from "@/stores/log-store"
import { useEditStore } from "@/stores/edit-store"
import { useExportStore } from "@/stores/export-store"
import { useSourceStore } from "@/stores/source-store"

const FORMAT_KEYS: Record<OutputFormat, TranslationKey> = {
  mp4: "export.format.mp4",
  gif: "export.format.gif",
  mp3: "export.format.mp3",
}

const FORMAT_LABELS: Record<OutputFormat, string> = {
  mp4: "MP4",
  gif: "GIF",
  mp3: "MP3",
}

const QUALITY_LABEL_KEYS: Record<ExportQuality, TranslationKey> = {
  high: "export.qualityHigh",
  balanced: "export.qualityBalanced",
  compact: "export.qualityCompact",
}

const QUALITY_DESCRIPTION_KEYS: Record<ExportQuality, TranslationKey> = {
  high: "export.qualityHighDescription",
  balanced: "export.qualityBalancedDescription",
  compact: "export.qualityCompactDescription",
}

interface ToggleRowProps {
  id: string
  title: string
  description: string
  detail?: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}

function ToggleRow({
  id,
  title,
  description,
  detail,
  checked,
  disabled,
  onCheckedChange,
}: ToggleRowProps) {
  const descriptionId = `${id}-description`

  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-xs font-medium">
          {title}
        </Label>
        <p
          id={descriptionId}
          className="mt-0.5 text-[10px] leading-snug text-muted-foreground"
          title={detail}
        >
          {description}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={descriptionId}
        className="mt-0.5 shrink-0"
      />
    </div>
  )
}

export function ExportPanel() {
  const { t } = useI18n()
  const streamUrl = useSourceStore((s) => s.streamUrl)
  const isLive = useSourceStore((s) => s.isLive)
  const audioUrl = useSourceStore((s) => s.audioUrl)
  const audioTrackId = useSourceStore((s) => s.audioTrackId)
  const meta = useSourceStore((s) => s.meta)
  const headers = useSourceStore((s) => s.headers)
  const headerToken = useSourceStore((s) => s.headerToken)
  const trim = useEditStore((s) => s.trim)
  const crop = useEditStore((s) => s.crop)
  const setCropEnabled = useEditStore((s) => s.setCropEnabled)
  const cutMode = useExportStore((s) => s.cutMode)
  const outputFormat = useExportStore((s) => s.outputFormat)
  const quality = useExportStore((s) => s.quality)
  const filename = useExportStore((s) => s.filename)
  const gpuEnabled = useExportStore((s) => s.gpuEnabled)
  const activeJobIds = useExportStore((s) => s.activeJobIds)
  const setCutMode = useExportStore((s) => s.setCutMode)
  const setOutputFormat = useExportStore((s) => s.setOutputFormat)
  const setQuality = useExportStore((s) => s.setQuality)
  const setFilename = useExportStore((s) => s.setFilename)
  const setGpuEnabled = useExportStore((s) => s.setGpuEnabled)

  const startExport = useStartExport()
  const gpuCapability = useGpuCapability()
  const gpu = gpuCapability.data?.gpu
  const cropActive = Boolean(crop.enabled && crop.rect)
  const gpuEligible = outputFormat === "mp4" && (cropActive || cutMode !== "fast")
  const gpuReady = gpuEligible && Boolean(gpu?.available)
  const useGpu = gpuEnabled && gpuReady
  // Kalite seçimi MP4'te her zaman görünür; hızlı kesimde seçim yapılınca
  // aşağıdaki handler otomatik olarak hassas (yeniden kodlanan) moda geçer.
  const qualitySelectable = outputFormat === "mp4"
  const qualityApplicable = qualitySelectable && gpuEligible
  // Hızlı kopyada kalite profili uygulanmaz; seçicide bunu "Orijinal" olarak
  // göster. Böylece aynı profil tekrar seçilse bile mod değişikliği tetiklenir.
  const qualityChoice: ExportQuality | "original" =
    qualitySelectable && !cropActive && cutMode === "fast" ? "original" : quality
  const qualityDescription = !qualitySelectable
    ? t("export.qualityNotApplicable")
    : qualityChoice === "original"
      ? t("export.qualityOriginalDescription")
      : t(QUALITY_DESCRIPTION_KEYS[quality])
  const qualityHint = qualitySelectable
    ? t(
        qualityChoice === "original"
          ? "export.qualityFastNote"
          : "export.qualitySavingsNote",
      )
    : null

  const gpuHint = (() => {
    if (gpuCapability.isPending) return t("gpu.checking")
    if (gpuCapability.isError || !gpu) return t("gpu.detectFailed")
    if (!gpu.available) return gpu.reason ?? t("gpu.unavailable")
    if (outputFormat !== "mp4") return t("gpu.mp4Only")
    if (cutMode === "fast" && !cropActive) return t("gpu.fastDisabled")
    return t("gpu.ready", { encoder: gpu.label ?? "GPU" })
  })()

  const clipDuration = trim.end - trim.start
  const invalidRange = isLive || !streamUrl || clipDuration <= 0.05
  const modeLabel = cutMode === "fast" ? t("export.fast") : t("export.exact")
  const summaryMeta = [
    modeLabel,
    qualityApplicable ? t(QUALITY_LABEL_KEYS[quality]) : null,
    meta && meta.width > 0 ? `${meta.width}×${meta.height}` : null,
    cropActive && crop.rect
      ? `${t("export.crop")} ${crop.rect.width}×${crop.rect.height}`
      : null,
    useGpu ? "GPU" : null,
  ]
    .filter(Boolean)
    .join(" · ")

  const handleQualityChange = (value: string) => {
    if (value === "original") {
      setCutMode("fast")
      return
    }

    setQuality(value as ExportQuality)
    // Sıkıştırma yalnızca yeniden kodlamada uygulanır.
    setCutMode("exact")
  }

  const handleExport = () => {
    if (!streamUrl || invalidRange || isLive) return

    const cropPayload: CropPayload | null =
      crop.enabled && crop.rect && meta
        ? {
            enabled: true,
            ...crop.rect,
            source_width: meta.width,
            source_height: meta.height,
          }
        : null

    // Kaynağın sesi yoksa (ör. YouTube HLS) ses ayrı akıştan eklenir. Alternatif
    // bir ses rendition'ı seçildiyse kaynaktaki gömülü ses yerine o kullanılır.
    const separateAudio =
      audioTrackId && audioUrl ? audioUrl : meta && !meta.hasAudio ? audioUrl : null

    startExport.mutate({
      url: streamUrl,
      start_time: trim.start,
      end_time: trim.end,
      mode: cutMode,
      output_format: outputFormat,
      quality: qualityApplicable ? quality : undefined,
      crop: cropPayload,
      filename,
      encoder: useGpu ? "gpu" : "cpu",
      audio_url: separateAudio,
      headers: headers ?? undefined,
      header_token: headerToken ?? undefined,
    })

    const details = [
      cropPayload
        ? t("log.exportRequestedCrop", {
            width: cropPayload.width,
            height: cropPayload.height,
            x: cropPayload.x,
            y: cropPayload.y,
          })
        : separateAudio
          ? t("log.exportRequestedAudio")
          : null,
      useGpu ? t("log.exportGpu", { encoder: gpu?.label ?? "GPU" }) : null,
    ]
      .filter(Boolean)
      .join(" · ")

    log(
      "info",
      t("log.exportRequested", {
        name: filename.trim() || t("log.autoName"),
        mode: cutMode === "fast" ? t("export.modeFast") : t("export.modeExact"),
        format: outputFormat.toUpperCase(),
        start: formatTime(trim.start, true),
        end: formatTime(trim.end, true),
      }),
      details || undefined,
    )
  }

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-border/70 bg-muted/20 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[10px] font-medium text-muted-foreground">
              {t("export.selection")}
            </h3>
            <p className="mt-1 truncate font-mono text-[13px] tabular-nums">
              {formatTime(trim.start, true)}
              <span className="mx-1.5 text-muted-foreground">→</span>
              {formatTime(trim.end, true)}
            </p>
          </div>
          <span className="shrink-0 rounded-md bg-background px-2 py-1 font-mono text-[11px] tabular-nums text-muted-foreground ring-1 ring-border/60">
            {compactDuration(Math.max(0, clipDuration))}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-semibold tracking-wide text-primary">
            {FORMAT_LABELS[outputFormat]}
          </span>
          {summaryMeta && <span className="tabular-nums">{summaryMeta}</span>}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border/70 p-3">
        <h3 className="text-xs font-semibold">{t("export.settings")}</h3>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="cut-mode" className="text-[11px] font-medium text-muted-foreground">
              {t("export.cutMode")}
            </Label>
            <Select
              value={cutMode}
              onValueChange={(value) => setCutMode(value as CutMode)}
            >
              <SelectTrigger id="cut-mode" className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fast" className="text-xs">
                  {t("export.fast")}
                </SelectItem>
                <SelectItem value="exact" className="text-xs">
                  {t("export.exact")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="output-format" className="text-[11px] font-medium text-muted-foreground">
              {t("export.outputFormat")}
            </Label>
            <Select
              value={outputFormat}
              onValueChange={(value) => setOutputFormat(value as OutputFormat)}
            >
              <SelectTrigger id="output-format" className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FORMAT_KEYS) as OutputFormat[]).map((value) => (
                  <SelectItem key={value} value={value} className="text-xs">
                    {t(FORMAT_KEYS[value])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="text-[10px] leading-snug text-muted-foreground">
          {cutMode === "fast" ? t("export.fastDescription") : t("export.exactDescription")}
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="export-quality" className="text-[11px] font-medium text-muted-foreground">
            {t("export.quality")}
          </Label>
          <Select
            value={qualityChoice}
            onValueChange={handleQualityChange}
            disabled={!qualitySelectable}
          >
            <SelectTrigger id="export-quality" className="w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {qualitySelectable && !cropActive && (
                <SelectItem value="original" className="text-xs">
                  {t("export.qualityOriginal")}
                </SelectItem>
              )}
              {(Object.keys(QUALITY_LABEL_KEYS) as ExportQuality[]).map((value) => (
                <SelectItem key={value} value={value} className="text-xs">
                  {t(QUALITY_LABEL_KEYS[value])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] leading-snug text-muted-foreground">
            {qualityDescription}
          </p>
          {qualityHint && (
            <p className="text-[10px] leading-snug text-muted-foreground/80">
              {qualityHint}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filename" className="text-[11px] font-medium text-muted-foreground">
            {t("export.filename")}
          </Label>
          <Input
            id="filename"
            className="h-8 text-xs"
            placeholder={t("export.filenamePlaceholder")}
            value={filename}
            onChange={(event) => setFilename(event.target.value)}
          />
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-border/70">
        <div className="border-b border-border/60 bg-muted/20 px-3 py-2">
          <h3 className="text-xs font-semibold">{t("export.options")}</h3>
        </div>
        <div className="divide-y divide-border/60">
          <ToggleRow
            id="gpu-render"
            title={t("gpu.title")}
            description={gpuHint}
            detail={gpu?.detail ?? undefined}
            checked={useGpu}
            onCheckedChange={setGpuEnabled}
            disabled={!gpuReady || gpuCapability.isPending}
          />
          <ToggleRow
            id="crop-enabled"
            title={crop.enabled ? t("export.cropOn") : t("export.cropOff")}
            description={crop.enabled ? t("export.cropHint") : t("export.cropOffHint")}
            checked={crop.enabled}
            onCheckedChange={setCropEnabled}
          />
        </div>
      </section>

      <Button
        className="h-9 w-full"
        onClick={handleExport}
        disabled={invalidRange || startExport.isPending}
        title={isLive ? t("export.liveDisabled") : t("export.startTitle")}
      >
        {startExport.isPending ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
        {activeJobIds.length > 0 ? t("export.exportNew") : t("export.export")}
      </Button>
    </div>
  )
}
