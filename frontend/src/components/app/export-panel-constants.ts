import type { TranslationKey } from "@/i18n"
import type { ExportCodec, ExportQuality, OutputFormat } from "@/lib/types"

/** The visible profile combines stream copy and the re-encode quality levels. */
export type ExportProfile = "original" | ExportQuality

export const FORMAT_LABELS: Record<OutputFormat, string> = {
  mp4: "MP4",
  gif: "GIF",
  mp3: "MP3",
}

export const FORMAT_NOTE_KEYS: Record<OutputFormat, TranslationKey> = {
  mp4: "export.formatNote.mp4",
  gif: "export.formatNote.gif",
  mp3: "export.formatNote.mp3",
}

export const PROFILE_LABEL_KEYS: Record<ExportProfile, TranslationKey> = {
  original: "export.profileOriginal",
  high: "export.profileHigh",
  balanced: "export.profileBalanced",
  compact: "export.profileCompact",
}

export const QUALITY_DESCRIPTION_KEYS: Record<ExportQuality, TranslationKey> = {
  high: "export.qualityHighDescription",
  balanced: "export.qualityBalancedDescription",
  compact: "export.qualityCompactDescription",
}

export const CODEC_LABEL_KEYS: Record<ExportCodec, TranslationKey> = {
  h264: "export.codecH264",
  hevc: "export.codecHevc",
}

export const CODEC_DESCRIPTION_KEYS: Record<ExportCodec, TranslationKey> = {
  h264: "export.codecH264Description",
  hevc: "export.codecHevcDescription",
}

export const FRAME_RATE_SOURCE = "source"
export const FRAME_RATE_30 = "30"
