/** Export tab: selected range, output profile, advanced settings and action. */
import { useEffect, useRef, useState } from "react"

import { useStartExport } from "@/hooks/use-export-job"
import { useGpuCapability } from "@/hooks/use-gpu-capability"
import { useI18n } from "@/i18n"
import { formatTime } from "@/lib/format"
import type {
  CropPayload,
  ExportCodec,
  ExportQuality,
  OutputFormat,
} from "@/lib/types"
import { log } from "@/stores/log-store"
import { outputDuration, useEditStore } from "@/stores/edit-store"
import { useExportStore } from "@/stores/export-store"
import { useSourceStore } from "@/stores/source-store"

import { ExportActionBar } from "./export-action-bar"
import { ExportAdvancedSettings } from "./export-advanced-settings"
import { ExportOutputSettings } from "./export-output-settings"
import { ExportSummary } from "./export-summary"
import type { ExportProfile } from "./export-panel-constants"

const MIN_EXPORT_PENDING_MS = 1000

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
  const segments = useEditStore((s) => s.segments)
  const crop = useEditStore((s) => s.crop)

  const cutMode = useExportStore((s) => s.cutMode)
  const outputFormat = useExportStore((s) => s.outputFormat)
  const quality = useExportStore((s) => s.quality)
  const codec = useExportStore((s) => s.codec)
  const outputFps = useExportStore((s) => s.outputFps)
  const filename = useExportStore((s) => s.filename)
  const gpuEnabled = useExportStore((s) => s.gpuEnabled)
  const activeJobIds = useExportStore((s) => s.activeJobIds)

  const setCutMode = useExportStore((s) => s.setCutMode)
  const setOutputFormat = useExportStore((s) => s.setOutputFormat)
  const setQuality = useExportStore((s) => s.setQuality)
  const setCodec = useExportStore((s) => s.setCodec)
  const setOutputFps = useExportStore((s) => s.setOutputFps)
  const setFilename = useExportStore((s) => s.setFilename)
  const setGpuEnabled = useExportStore((s) => s.setGpuEnabled)

  const startExport = useStartExport()
  const [justStarted, setJustStarted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const startedTimerRef = useRef<number | null>(null)
  const submitTimerRef = useRef<number | null>(null)
  const submitStartedAtRef = useRef(0)
  const submittingRef = useRef(false)
  const gpuCapability = useGpuCapability()
  const gpu = gpuCapability.data?.gpu
  const features = gpuCapability.data?.features

  const hevcAvailable = Boolean(features?.hevc)
  const frameRateAvailable = Boolean(features?.frame_rate)
  const sourceFps = meta?.fps ?? 0
  const cropActive = Boolean(crop.enabled && crop.rect)
  const cropApplies = cropActive && outputFormat !== "mp3"
  const cropWidth = cropApplies && crop.rect ? crop.rect.width : null
  const cropHeight = cropApplies && crop.rect ? crop.rect.height : null

  const effectiveCodec: ExportCodec = hevcAvailable ? codec : "h264"
  const frameRateOptionVisible =
    outputFormat === "mp4" &&
    frameRateAvailable &&
    (sourceFps === 0 || sourceFps > 30)
  const effectiveOutputFps = frameRateOptionVisible ? outputFps : null
  const requiresReencode =
    cropApplies ||
    cutMode !== "fast" ||
    effectiveCodec === "hevc" ||
    effectiveOutputFps !== null
  const gpuEligible =
    outputFormat === "mp4" && effectiveCodec === "h264" && requiresReencode
  const gpuReady = gpuEligible && Boolean(gpu?.available)
  const useGpu = gpuEnabled && gpuReady
  const qualityApplicable = outputFormat === "mp4" && requiresReencode

  // "Original" only makes sense for a real stream copy. Crop, H.265 and 30 fps
  // all force a re-encode, so keep the option visible but disabled.
  const originalBlockers = [
    cropApplies ? t("export.reasonCrop") : null,
    effectiveCodec === "hevc" ? "H.265" : null,
    effectiveOutputFps !== null ? `${effectiveOutputFps} fps` : null,
  ].filter((value): value is string => Boolean(value))
  const originalAvailable =
    outputFormat === "mp4" && originalBlockers.length === 0
  const profile: ExportProfile =
    cutMode === "fast" && originalAvailable ? "original" : quality

  // Çoklu kesimde dışa aktarılan süre, kalan parçaların toplamıdır.
  const clipDuration = outputDuration(segments)
  const invalidReason = isLive
    ? t("export.liveDisabled")
    : !streamUrl
      ? t("export.noSource")
      : segments.length === 0
        ? t("export.nothingToExport")
        : segments.length > 1 && outputFormat !== "mp4"
          ? t("export.multiSegmentMp4Only")
          : clipDuration <= 0.05
            ? t("export.rangeTooShort")
            : null

  const gpuHint = (() => {
    if (gpuCapability.isPending) return t("gpu.checking")
    if (gpuCapability.isError || !gpu) return t("gpu.detectFailed")
    if (!gpu.available) return t("gpu.unavailable")
    if (effectiveCodec === "hevc") return t("gpu.shortHevc")
    if (!requiresReencode) return t("gpu.shortFastCopy")
    return t("gpu.shortReady", { encoder: gpu.label ?? "GPU" })
  })()

  const gpuTooltip = (() => {
    if (gpuCapability.isPending) return t("gpu.checking")
    if (gpuCapability.isError || !gpu) return t("gpu.detectFailed")
    if (!gpu.available) return gpu.reason ?? t("gpu.unavailable")
    if (effectiveCodec === "hevc") return t("gpu.hevcCpu")
    if (!requiresReencode) return t("gpu.fastDisabled")
    return gpu.detail ?? t("gpu.ready", { encoder: gpu.label ?? "GPU" })
  })()

  const deviations = [
    cropApplies && crop.rect
      ? t("export.summaryCrop", {
          width: crop.rect.width,
          height: crop.rect.height,
        })
      : null,
    outputFormat === "mp4" && effectiveCodec === "hevc" ? "H.265" : null,
    effectiveOutputFps !== null
      ? t("export.summaryFps", { fps: effectiveOutputFps })
      : null,
    useGpu ? t("export.summaryGpu") : null,
    segments.length > 1
      ? t("export.summaryPieces", { count: segments.length })
      : null,
  ].filter((value): value is string => Boolean(value))

  useEffect(() => {
    return () => {
      if (startedTimerRef.current !== null) {
        window.clearTimeout(startedTimerRef.current)
      }
      if (submitTimerRef.current !== null) {
        window.clearTimeout(submitTimerRef.current)
      }
    }
  }, [])

  const flashStarted = () => {
    setJustStarted(true)
    if (startedTimerRef.current !== null) {
      window.clearTimeout(startedTimerRef.current)
    }
    startedTimerRef.current = window.setTimeout(() => {
      setJustStarted(false)
      startedTimerRef.current = null
    }, 2000)
  }

  const finishSubmit = (success: boolean) => {
    const elapsed = Date.now() - submitStartedAtRef.current
    const remaining = Math.max(0, MIN_EXPORT_PENDING_MS - elapsed)

    if (submitTimerRef.current !== null) {
      window.clearTimeout(submitTimerRef.current)
    }

    submitTimerRef.current = window.setTimeout(() => {
      submitTimerRef.current = null
      submittingRef.current = false
      setSubmitting(false)
      if (success) flashStarted()
    }, remaining)
  }

  const handleOutputFormatChange = (format: OutputFormat) => {
    setOutputFormat(format)
  }

  const handleProfileChange = (value: string) => {
    if (value === "original") {
      if (!originalAvailable) return
      setCodec("h264")
      setOutputFps(null)
      setCutMode("fast")
      return
    }

    setQuality(value as ExportQuality)
    setCutMode("exact")
  }

  const handleCodecChange = (value: string) => {
    const nextCodec = value as ExportCodec
    setCodec(nextCodec)
    if (nextCodec === "hevc") setCutMode("exact")
  }

  const handleOutputFpsChange = (value: string) => {
    if (value === "source") {
      setOutputFps(null)
      return
    }
    setOutputFps(30)
    setCutMode("exact")
  }

  const focusJobsDock = () => {
    const dock = document.querySelector<HTMLElement>('[data-slot="jobs-dock"]')
    if (!dock) return

    const toggle = dock.querySelector<HTMLButtonElement>(
      '[data-slot="jobs-dock-toggle"]',
    )
    if (!toggle) return

    // Focus alone does not reveal a collapsed dock, so open it first.
    if (toggle.getAttribute("aria-expanded") === "false") toggle.click()
    toggle.focus({ preventScroll: true })
  }

  const editCrop = () => {
    const trigger = document.querySelector<HTMLButtonElement>(
      '[data-slot="crop-menu-trigger"]',
    )
    if (!trigger) return
    trigger.scrollIntoView({ behavior: "smooth", block: "center" })
    trigger.focus({ preventScroll: true })
    trigger.click()
  }

  const handleExport = () => {
    if (
      !streamUrl ||
      invalidReason ||
      submittingRef.current ||
      startExport.isPending
    ) {
      return
    }

    if (startedTimerRef.current !== null) {
      window.clearTimeout(startedTimerRef.current)
      startedTimerRef.current = null
    }
    if (submitTimerRef.current !== null) {
      window.clearTimeout(submitTimerRef.current)
      submitTimerRef.current = null
    }
    setJustStarted(false)
    setSubmitting(true)
    submittingRef.current = true
    submitStartedAtRef.current = Date.now()

    const cropPayload: CropPayload | null =
      cropApplies && crop.rect && meta
        ? {
            enabled: true,
            ...crop.rect,
            source_width: meta.width,
            source_height: meta.height,
          }
        : null

    // A source without embedded audio (for example YouTube HLS) can use a
    // separate audio stream. A selected audio rendition wins over embedded audio.
    const separateAudio =
      audioTrackId && audioUrl
        ? audioUrl
        : meta && !meta.hasAudio
          ? audioUrl
          : null

    // The backend always appends the extension; strip one typed by the user so
    // "clip.mp4" does not become "clip.mp4.mp4".
    const filenameForExport = filename
      .trim()
      .replace(/\.(mp4|gif|mp3)$/i, "")

    startExport.mutate(
      {
        url: streamUrl,
        start_time: trim.start,
        end_time: trim.end,
        // Birden çok parça varsa backend her parçayı ayrı işleyip birleştirir.
        segments:
          segments.length > 1
            ? segments.map((segment) => ({
                start_time: segment.start,
                end_time: segment.end,
              }))
            : undefined,
        mode: cutMode,
        output_format: outputFormat,
        quality: qualityApplicable ? quality : undefined,
        codec: outputFormat === "mp4" ? effectiveCodec : undefined,
        output_fps: outputFormat === "mp4" ? effectiveOutputFps : null,
        crop: cropPayload,
        filename: filenameForExport,
        encoder: useGpu ? "gpu" : "cpu",
        audio_url: separateAudio,
        headers: headers ?? undefined,
        header_token: headerToken ?? undefined,
      },
      {
        onSettled: (_data, error) => {
          finishSubmit(!error)
        },
      },
    )

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
      segments.length > 1
        ? t("log.exportPieces", { count: segments.length })
        : null,
    ].filter(Boolean).join(" · ")

    log(
      "info",
      t("log.exportRequested", {
        name: filenameForExport || t("log.autoName"),
        mode: cutMode === "fast" ? t("export.modeFast") : t("export.modeExact"),
        format: outputFormat.toUpperCase(),
        start: formatTime(trim.start, true),
        end: formatTime(trim.end, true),
      }),
      details || undefined,
    )
  }

  return (
    <div
      data-slot="export-panel"
      className="rounded-xl border border-border/70 bg-card"
    >
      <ExportSummary
        start={trim.start}
        end={trim.end}
        duration={clipDuration}
        outputFormat={outputFormat}
        profile={outputFormat === "mp4" ? profile : null}
        deviations={deviations}
      />

      <ExportOutputSettings
        outputFormat={outputFormat}
        onOutputFormatChange={handleOutputFormatChange}
        profile={profile}
        onProfileChange={handleProfileChange}
        originalAvailable={originalAvailable}
        originalBlockers={originalBlockers}
        filename={filename}
        onFilenameChange={setFilename}
        onResetFilename={() => setFilename("")}
      />

      <ExportAdvancedSettings
        outputFormat={outputFormat}
        hevcAvailable={hevcAvailable}
        codec={codec}
        effectiveCodec={effectiveCodec}
        onCodecChange={handleCodecChange}
        frameRateAvailable={frameRateAvailable}
        sourceFps={sourceFps}
        effectiveOutputFps={effectiveOutputFps}
        onOutputFpsChange={handleOutputFpsChange}
        gpuReady={gpuReady}
        gpuPending={gpuCapability.isPending}
        useGpu={useGpu}
        onGpuChange={setGpuEnabled}
        gpuHint={gpuHint}
        gpuTooltip={gpuTooltip}
        cropActive={cropApplies}
        cropWidth={cropWidth}
        cropHeight={cropHeight}
        onEditCrop={editCrop}
      />

      <ExportActionBar
        outputFormat={outputFormat}
        duration={clipDuration}
        activeJobCount={activeJobIds.length}
        disabledReason={invalidReason}
        pending={submitting || startExport.isPending}
        started={justStarted}
        onExport={handleExport}
        onFocusJobs={focusJobsDock}
      />
    </div>
  )
}
