/** Dışa aktarma sekmesi: kesim modu, format, kırpma durumu ve iş başlatma. */
import { DownloadIcon, Loader2Icon } from "lucide-react"

import { JobProgress } from "@/components/app/job-progress"
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
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useStartExport } from "@/hooks/use-export-job"
import { useGpuCapability } from "@/hooks/use-gpu-capability"
import { useI18n, type TranslationKey } from "@/i18n"
import { compactDuration, formatTime } from "@/lib/format"
import type { CropPayload, CutMode, OutputFormat } from "@/lib/types"
import { log } from "@/stores/log-store"
import { useStudioStore } from "@/stores/studio-store"

const FORMAT_KEYS: Record<OutputFormat, TranslationKey> = {
  mp4: "export.format.mp4",
  gif: "export.format.gif",
  mp3: "export.format.mp3",
}

export function ExportPanel() {
  const { t } = useI18n()
  const streamUrl = useStudioStore((s) => s.streamUrl)
  const audioUrl = useStudioStore((s) => s.audioUrl)
  const meta = useStudioStore((s) => s.meta)
  const trim = useStudioStore((s) => s.trim)
  const crop = useStudioStore((s) => s.crop)
  const cutMode = useStudioStore((s) => s.cutMode)
  const outputFormat = useStudioStore((s) => s.outputFormat)
  const filename = useStudioStore((s) => s.filename)
  const gpuEnabled = useStudioStore((s) => s.gpuEnabled)
  const activeJobIds = useStudioStore((s) => s.activeJobIds)
  const headers = useStudioStore((s) => s.headers)
  const setCropEnabled = useStudioStore((s) => s.setCropEnabled)
  const setCutMode = useStudioStore((s) => s.setCutMode)
  const setOutputFormat = useStudioStore((s) => s.setOutputFormat)
  const setFilename = useStudioStore((s) => s.setFilename)
  const setGpuEnabled = useStudioStore((s) => s.setGpuEnabled)

  const startExport = useStartExport()
  const gpuCapability = useGpuCapability()
  const gpu = gpuCapability.data?.gpu
  const cropActive = Boolean(crop.enabled && crop.rect)
  const gpuEligible = outputFormat === "mp4" && (cropActive || cutMode !== "fast")
  const gpuReady = gpuEligible && Boolean(gpu?.available)
  const useGpu = gpuEnabled && gpuReady

  const gpuHint = (() => {
    if (gpuCapability.isPending) return t("gpu.checking")
    if (gpuCapability.isError || !gpu) return t("gpu.detectFailed")
    if (!gpu.available) return gpu.reason ?? t("gpu.unavailable")
    if (outputFormat !== "mp4") return t("gpu.mp4Only")
    if (cutMode === "fast" && !cropActive) return t("gpu.fastDisabled")
    return t("gpu.ready", { encoder: gpu.label ?? "GPU" })
  })()

  const clipDuration = trim.end - trim.start
  const invalidRange = !streamUrl || clipDuration <= 0.05

  const handleExport = () => {
    if (!streamUrl || invalidRange) return

    const cropPayload: CropPayload | null =
      crop.enabled && crop.rect && meta
        ? {
            enabled: true,
            ...crop.rect,
            source_width: meta.width,
            source_height: meta.height,
          }
        : null

    // Kaynağın sesi yoksa (ör. YouTube HLS) ses ayrı akıştan eklenir.
    const separateAudio = meta && !meta.hasAudio && audioUrl ? audioUrl : null

    startExport.mutate({
      url: streamUrl,
      start_time: trim.start,
      end_time: trim.end,
      mode: cutMode,
      output_format: outputFormat,
      crop: cropPayload,
      filename,
      encoder: useGpu ? "gpu" : "cpu",
      audio_url: separateAudio,
      headers: headers ?? undefined,
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
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t("export.selectRange")}</p>

      <div className="space-y-2">
        <Label className="text-xs">{t("export.cutMode")}</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={cutMode}
          onValueChange={(value) => {
            if (value) setCutMode(value as CutMode)
          }}
          className="w-full"
        >
          <ToggleGroupItem value="fast" className="flex-1">
            {t("export.fast")}
          </ToggleGroupItem>
          <ToggleGroupItem value="exact" className="flex-1">
            {t("export.exact")}
          </ToggleGroupItem>
        </ToggleGroup>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {cutMode === "fast" ? t("export.fastDescription") : t("export.exactDescription")}
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">{t("export.outputFormat")}</Label>
        <Select
          value={outputFormat}
          onValueChange={(value) => setOutputFormat(value as OutputFormat)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(FORMAT_KEYS) as OutputFormat[]).map((value) => (
              <SelectItem key={value} value={value}>
                {t(FORMAT_KEYS[value])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-start justify-between gap-3 rounded-lg bg-muted/40 px-2.5 py-2">
        <div className="min-w-0">
          <Label htmlFor="gpu-render" className="text-xs">
            {t("gpu.title")}
          </Label>
          <p
            className="mt-0.5 text-[10px] leading-snug text-muted-foreground"
            title={gpu?.detail ?? undefined}
          >
            {gpuHint}
          </p>
        </div>
        <Switch
          id="gpu-render"
          checked={useGpu}
          onCheckedChange={setGpuEnabled}
          disabled={!gpuReady || gpuCapability.isPending}
          className="mt-0.5 shrink-0"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs" htmlFor="filename">
          {t("export.filename")}
        </Label>
        <Input
          id="filename"
          placeholder={t("export.filenamePlaceholder")}
          value={filename}
          onChange={(event) => setFilename(event.target.value)}
        />
      </div>

      <div className="flex items-center justify-between rounded-lg bg-muted/40 px-2.5 py-2">
        <span className="text-xs">
          {crop.enabled ? t("export.cropOn") : t("export.cropOff")}
          <span className="block text-[10px] text-muted-foreground">
            {t("export.cropHint")}
          </span>
        </span>
        <Switch checked={crop.enabled} onCheckedChange={setCropEnabled} />
      </div>

      <Separator />

      <dl className="space-y-1.5 text-xs">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">{t("export.range")}</dt>
          <dd className="font-mono">
            {formatTime(trim.start, true)} → {formatTime(trim.end, true)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">{t("export.duration")}</dt>
          <dd className="font-mono">{compactDuration(Math.max(0, clipDuration))}</dd>
        </div>
        {crop.enabled && crop.rect && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">{t("export.crop")}</dt>
            <dd className="font-mono">
              {crop.rect.width}×{crop.rect.height} @ {crop.rect.x},{crop.rect.y}
            </dd>
          </div>
        )}
        {meta && meta.width > 0 && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">{t("export.source")}</dt>
            <dd className="font-mono">
              {meta.width}×{meta.height}
            </dd>
          </div>
        )}
      </dl>

      <Button
        className="w-full"
        onClick={handleExport}
        disabled={invalidRange || startExport.isPending}
        title={t("export.startTitle")}
      >
        {startExport.isPending ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
        {activeJobIds.length > 0 ? t("export.exportNew") : t("export.export")}
      </Button>

      {activeJobIds.length > 0 && (
        <div className="space-y-2">
          {activeJobIds.length > 1 && (
            <p className="text-[11px] text-muted-foreground">
              {t("export.processing", { count: activeJobIds.length })}
            </p>
          )}
          {activeJobIds.map((jobId) => (
            <JobProgress key={jobId} jobId={jobId} />
          ))}
        </div>
      )}
    </div>
  )
}
