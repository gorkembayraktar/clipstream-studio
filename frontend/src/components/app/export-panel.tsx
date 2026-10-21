/** Dışa aktarma sekmesi: seçili aralık, çıktı ayarları, seçenekler ve işler. */
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
import { Switch } from "@/components/ui/switch"
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

const FORMAT_LABELS: Record<OutputFormat, string> = {
  mp4: "MP4",
  gif: "GIF",
  mp3: "MP3",
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
  const modeLabel = cutMode === "fast" ? t("export.fast") : t("export.exact")
  const summaryMeta = [
    modeLabel,
    meta && meta.width > 0 ? `${meta.width}×${meta.height}` : null,
    cropActive && crop.rect
      ? `${t("export.crop")} ${crop.rect.width}×${crop.rect.height}`
      : null,
    useGpu ? "GPU" : null,
  ]
    .filter(Boolean)
    .join(" · ")

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
        title={t("export.startTitle")}
      >
        {startExport.isPending ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
        {activeJobIds.length > 0 ? t("export.exportNew") : t("export.export")}
      </Button>

      {activeJobIds.length > 0 && (
        <section className="space-y-2 border-t border-border/60 pt-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold">{t("export.activeJobs")}</h3>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
              {activeJobIds.length}
            </span>
          </div>
          <div className="space-y-2">
            {activeJobIds.map((jobId) => (
              <JobProgress key={jobId} jobId={jobId} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
