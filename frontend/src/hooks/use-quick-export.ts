/** Ana timeline sağ tık menüsünden hızlı dışa aktarma.
 *
 * Paneldeki ayrıntılı ayarlara dokunmadan, seçilen format + profil ile işi
 * doğrudan başlatır. In/Out seçimi dışa aktarmanın sınırıdır: yalnızca seçimle
 * kesişen parçalar gönderilir.
 */
import { useCallback, useMemo } from "react"

import type { ExportProfile } from "@/components/app/export-panel-constants"
import { useStartExport } from "@/hooks/use-export-job"
import { useGpuCapability } from "@/hooks/use-gpu-capability"
import { useI18n } from "@/i18n"
import { formatTime } from "@/lib/format"
import type {
  CropPayload,
  ExportQuality,
  OutputFormat,
} from "@/lib/types"
import { clippedSegments, useEditStore } from "@/stores/edit-store"
import { useExportStore } from "@/stores/export-store"
import { log } from "@/stores/log-store"
import { anchorAtTime, useSourceStore } from "@/stores/source-store"

/** Menüdeki MP4 profilleri (orijinal = yeniden kodlamasız kopya). */
export const QUICK_EXPORT_PROFILES: ExportProfile[] = [
  "original",
  "high",
  "balanced",
  "compact",
]

export function useQuickExport() {
  const { t } = useI18n()
  const startExport = useStartExport()
  const gpuCapability = useGpuCapability()

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

  const filename = useExportStore((s) => s.filename)
  const codec = useExportStore((s) => s.codec)
  const outputFps = useExportStore((s) => s.outputFps)
  const gpuEnabled = useExportStore((s) => s.gpuEnabled)
  const setOutputFormat = useExportStore((s) => s.setOutputFormat)
  const setQuality = useExportStore((s) => s.setQuality)
  const setCutMode = useExportStore((s) => s.setCutMode)

  const exportSegments = useMemo(
    () => clippedSegments(segments, trim),
    [segments, trim],
  )
  const duration = exportSegments.reduce(
    (total, segment) => total + (segment.end - segment.start),
    0,
  )

  const cropApplies = Boolean(crop.enabled && crop.rect)
  /** Orijinal (yeniden kodlamasız) kopya yalnızca engel yoksa mümkün. */
  const originalAvailable =
    !cropApplies && codec !== "hevc" && outputFps === null
  const multiSegment = exportSegments.length > 1
  const canExport =
    Boolean(streamUrl) && !isLive && duration > 0.05 && exportSegments.length > 0

  const run = useCallback(
    (format: OutputFormat, profile?: ExportProfile) => {
      if (!canExport || !streamUrl) return
      // Çoklu kesim yalnızca MP4 birleştirmesinde destekleniyor.
      if (format !== "mp4" && multiSegment) return
      if (profile === "original" && !originalAvailable) return

      const mode = profile === "original" ? "fast" : "exact"
      const quality: ExportQuality =
        profile && profile !== "original"
          ? profile
          : useExportStore.getState().quality

      // Panel aynı seçimleri göstersin diye mağaza da güncellenir.
      setOutputFormat(format)
      setCutMode(mode)
      if (format === "mp4" && profile !== "original") setQuality(quality)

      const cropPayload: CropPayload | null =
        cropApplies && crop.rect && meta
          ? {
              enabled: true,
              ...crop.rect,
              source_width: meta.width,
              source_height: meta.height,
            }
          : null
      const separateAudio =
        audioTrackId && audioUrl
          ? audioUrl
          : meta && !meta.hasAudio
            ? audioUrl
            : null
      const filenameForExport = filename
        .trim()
        .replace(/\.(mp4|gif|mp3)$/i, "")
      const encoder =
        gpuEnabled &&
        format === "mp4" &&
        mode === "exact" &&
        codec === "h264" &&
        Boolean(gpuCapability.data?.gpu?.available)
          ? "gpu"
          : "cpu"
      const first = exportSegments[0]
      const last = exportSegments[exportSegments.length - 1]
      // Canlı/DVR: klibin başladığı segmenti bildir (pencere kayması için).
      const timelineMap = useSourceStore.getState().timelineAnchor
      const anchor = timelineMap ? anchorAtTime(timelineMap, first.start) : null

      startExport.mutate({
        url: streamUrl,
        start_time: first.start,
        end_time: last.end,
        segments: multiSegment
          ? exportSegments.map((segment) => ({
              start_time: segment.start,
              end_time: segment.end,
            }))
          : undefined,
        mode,
        output_format: format,
        quality: format === "mp4" && mode === "exact" ? quality : undefined,
        codec:
          format === "mp4"
            ? profile === "original"
              ? "h264"
              : codec
            : undefined,
        output_fps: format === "mp4" ? outputFps : null,
        crop: cropPayload,
        filename: filenameForExport,
        encoder,
        audio_url: separateAudio,
        headers: headers ?? undefined,
        header_token: headerToken ?? undefined,
        anchor: anchor ?? undefined,
      })

      log(
        "info",
        t("log.exportRequested", {
          name: filenameForExport || t("log.autoName"),
          mode: mode === "fast" ? t("export.modeFast") : t("export.modeExact"),
          format: format.toUpperCase(),
          start: formatTime(first.start, true),
          end: formatTime(last.end, true),
        }),
        exportSegments.length > 1
          ? t("log.exportPieces", { count: exportSegments.length })
          : undefined,
      )
    },
    [
      audioTrackId,
      audioUrl,
      canExport,
      codec,
      crop,
      cropApplies,
      exportSegments,
      filename,
      gpuCapability.data?.gpu?.available,
      gpuEnabled,
      headerToken,
      headers,
      meta,
      multiSegment,
      originalAvailable,
      outputFps,
      setCutMode,
      setOutputFormat,
      setQuality,
      startExport.mutate,
      streamUrl,
      t,
    ],
  )

  return { run, canExport, multiSegment, originalAvailable, exportSegments }
}
