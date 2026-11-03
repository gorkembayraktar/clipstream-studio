import { useState } from "react"

import { ChevronDownIcon, CropIcon, SlidersHorizontalIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "cn"
import { useI18n } from "@/i18n"
import type { AudioMode, ExportCodec, OutputFormat } from "@/lib/types"

import { FieldLabel } from "./export-controls"
import {
  AUDIO_MODE_DESCRIPTION_KEYS,
  AUDIO_MODE_HINT_KEYS,
  AUDIO_MODE_LABEL_KEYS,
  CODEC_DESCRIPTION_KEYS,
  CODEC_LABEL_KEYS,
  FRAME_RATE_30,
  FRAME_RATE_SOURCE,
  OUTPUT_SCALE_HEIGHTS,
  OUTPUT_SCALE_SOURCE,
} from "./export-panel-constants"

interface ExportAdvancedSettingsProps {
  outputFormat: OutputFormat
  hevcAvailable: boolean
  codec: ExportCodec
  effectiveCodec: ExportCodec
  onCodecChange: (value: string) => void
  frameRateAvailable: boolean
  sourceFps: number
  effectiveOutputFps: number | null
  onOutputFpsChange: (value: string) => void
  sourceHeight: number
  outputScale: number | null
  onOutputScaleChange: (value: string) => void
  audioMode: AudioMode
  onAudioModeChange: (value: string) => void
  gpuReady: boolean
  gpuPending: boolean
  useGpu: boolean
  onGpuChange: (value: boolean) => void
  gpuHint: string
  gpuTooltip: string
  cropActive: boolean
  cropWidth: number | null
  cropHeight: number | null
  onEditCrop: () => void
}

export function ExportAdvancedSettings({
  outputFormat,
  hevcAvailable,
  codec,
  effectiveCodec,
  onCodecChange,
  frameRateAvailable,
  sourceFps,
  effectiveOutputFps,
  onOutputFpsChange,
  sourceHeight,
  outputScale,
  onOutputScaleChange,
  audioMode,
  onAudioModeChange,
  gpuReady,
  gpuPending,
  useGpu,
  onGpuChange,
  gpuHint,
  gpuTooltip,
  cropActive,
  cropWidth,
  cropHeight,
  onEditCrop,
}: ExportAdvancedSettingsProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  const showEncoder = outputFormat === "mp4" && hevcAvailable
  const showFrameRate =
    outputFormat === "mp4" &&
    frameRateAvailable &&
    (sourceFps === 0 || sourceFps > 30)
  // Yalnızca kaynaktan küçük yükseklikler sunulur: büyütme dosyayı şişirir.
  // GIF çıktısı zaten 480 px'e ölçeklendiği, MP3'te video olmadığı için
  // seçenek yalnızca MP4'te gösterilir.
  const scaleOptions = OUTPUT_SCALE_HEIGHTS.filter(
    (height) => sourceHeight <= 0 || height < sourceHeight,
  )
  const showScale = outputFormat === "mp4" && scaleOptions.length > 0
  const showAudio = outputFormat === "mp4"
  const showGpu = outputFormat === "mp4"
  const showCrop =
    cropActive &&
    outputFormat !== "mp3" &&
    cropWidth !== null &&
    cropHeight !== null
  const hasContent =
    showEncoder || showFrameRate || showScale || showAudio || showGpu || showCrop

  if (!hasContent) return null

  return (
    <section className="border-b border-border/60">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="export-advanced"
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/20 focus-visible:bg-muted/20 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset focus-visible:outline-none"
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <SlidersHorizontalIcon
            className="size-3.5 text-muted-foreground"
            aria-hidden
          />
          {t("export.advanced")}
        </span>
        <ChevronDownIcon
          className={cn(
            "size-3.5 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      <div
        id="export-advanced"
        className={cn("border-t border-border/60", !open && "hidden")}
      >
        <div className="divide-y divide-border/60">
          {showEncoder || showFrameRate ? (
            <div
              className={cn(
                "grid gap-2 px-3 py-2.5",
                showEncoder && showFrameRate ? "grid-cols-2" : "grid-cols-1",
              )}
            >
              {showEncoder ? (
                <div className="min-w-0 space-y-1.5">
                  <FieldLabel
                    htmlFor="export-codec"
                    label={t("export.codec")}
                    hint={t(CODEC_DESCRIPTION_KEYS[effectiveCodec])}
                    hintLabel={t("export.fieldInfo", {
                      field: t("export.codec"),
                    })}
                  />
                  <Select value={codec} onValueChange={onCodecChange}>
                    <SelectTrigger
                      id="export-codec"
                      className="h-9 w-full text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(CODEC_LABEL_KEYS) as ExportCodec[]).map(
                        (value) => (
                          <SelectItem
                            key={value}
                            value={value}
                            className="text-xs"
                          >
                            {t(CODEC_LABEL_KEYS[value])}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    {codec === "hevc"
                      ? t("export.codecHintHevc")
                      : t("export.codecHintH264")}
                  </p>
                </div>
              ) : null}

              {showFrameRate ? (
                <div className="min-w-0 space-y-1.5">
                  <FieldLabel
                    htmlFor="export-frame-rate"
                    label={t("export.frameRate")}
                    hint={
                      effectiveOutputFps
                        ? t("export.frameRate30Description")
                        : t("export.frameRateSourceDescription")
                    }
                    hintLabel={t("export.fieldInfo", {
                      field: t("export.frameRate"),
                    })}
                  />
                  <Select
                    value={
                      effectiveOutputFps
                        ? String(effectiveOutputFps)
                        : FRAME_RATE_SOURCE
                    }
                    onValueChange={onOutputFpsChange}
                  >
                    <SelectTrigger
                      id="export-frame-rate"
                      className="h-9 w-full text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        value={FRAME_RATE_SOURCE}
                        className="text-xs"
                      >
                        {t("export.frameRateSource")}
                      </SelectItem>
                      <SelectItem value={FRAME_RATE_30} className="text-xs">
                        {t("export.frameRate30")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    {effectiveOutputFps
                      ? t("export.frameRateHint30")
                      : t("export.frameRateHintSource")}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {showScale || showAudio ? (
            <div
              className={cn(
                "grid gap-2 px-3 py-2.5",
                showScale && showAudio ? "grid-cols-2" : "grid-cols-1",
              )}
            >
              {showScale ? (
                <div className="min-w-0 space-y-1.5">
                  <FieldLabel
                    htmlFor="export-resolution"
                    label={t("export.resolution")}
                    hint={
                      outputScale
                        ? t("export.resolutionDescription", {
                            height: outputScale,
                          })
                        : t("export.resolutionSourceDescription")
                    }
                    hintLabel={t("export.fieldInfo", {
                      field: t("export.resolution"),
                    })}
                  />
                  <Select
                    value={
                      outputScale ? String(outputScale) : OUTPUT_SCALE_SOURCE
                    }
                    onValueChange={onOutputScaleChange}
                  >
                    <SelectTrigger
                      id="export-resolution"
                      className="h-9 w-full text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        value={OUTPUT_SCALE_SOURCE}
                        className="text-xs"
                      >
                        {t("export.resolutionSource")}
                      </SelectItem>
                      {scaleOptions.map((height) => (
                        <SelectItem
                          key={height}
                          value={String(height)}
                          className="text-xs"
                        >
                          {t("export.resolutionOption", { height })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    {outputScale
                      ? t("export.resolutionHintScaled", { height: outputScale })
                      : t("export.resolutionHintSource")}
                  </p>
                </div>
              ) : null}

              {showAudio ? (
                <div className="min-w-0 space-y-1.5">
                  <FieldLabel
                    htmlFor="export-audio-mode"
                    label={t("export.audioMode")}
                    hint={t(AUDIO_MODE_DESCRIPTION_KEYS[audioMode])}
                    hintLabel={t("export.fieldInfo", {
                      field: t("export.audioMode"),
                    })}
                  />
                  <Select value={audioMode} onValueChange={onAudioModeChange}>
                    <SelectTrigger
                      id="export-audio-mode"
                      className="h-9 w-full text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(AUDIO_MODE_LABEL_KEYS) as AudioMode[]).map(
                        (value) => (
                          <SelectItem
                            key={value}
                            value={value}
                            className="text-xs"
                          >
                            {t(AUDIO_MODE_LABEL_KEYS[value])}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    {t(AUDIO_MODE_HINT_KEYS[audioMode])}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {showGpu ? (
            <div className="flex items-start justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <FieldLabel
                  htmlFor="export-gpu"
                  label={t("gpu.title")}
                  hint={gpuTooltip}
                  hintLabel={t("export.fieldInfo", {
                    field: t("gpu.title"),
                  })}
                />
                <p
                  id="export-gpu-hint"
                  className="mt-0.5 text-[10px] leading-snug text-muted-foreground"
                >
                  {gpuHint}
                </p>
              </div>
              <Switch
                id="export-gpu"
                checked={useGpu}
                onCheckedChange={onGpuChange}
                disabled={!gpuReady || gpuPending}
                aria-describedby="export-gpu-hint"
                className="mt-0.5 shrink-0"
              />
            </div>
          ) : null}

          {showCrop ? (
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <CropIcon
                    className="size-3.5 text-muted-foreground"
                    aria-hidden
                  />
                  {t("export.cropApplied")}
                </div>
                <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                  {cropWidth}×{cropHeight} · {t("export.cropReencodeHint")}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 px-2 text-[11px]"
                onClick={onEditCrop}
              >
                {t("export.editCrop")}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
