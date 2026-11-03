import type { TranslationKey } from "@/i18n"
import type {
  AudioMode,
  ExportCodec,
  ExportQuality,
  OutputFormat,
} from "@/lib/types"

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

/** Çıktı yüksekliği seçenekleri; kaynaktan büyük olanlar arayüzde gizlenir. */
export const OUTPUT_SCALE_HEIGHTS = [1080, 720, 480, 360] as const

export const OUTPUT_SCALE_SOURCE = "source"

export const AUDIO_MODE_LABEL_KEYS: Record<AudioMode, TranslationKey> = {
  auto: "export.audioAuto",
  voice: "export.audioVoice",
  strip: "export.audioStrip",
}

export const AUDIO_MODE_DESCRIPTION_KEYS: Record<AudioMode, TranslationKey> = {
  auto: "export.audioAutoDescription",
  voice: "export.audioVoiceDescription",
  strip: "export.audioStripDescription",
}

export const AUDIO_MODE_HINT_KEYS: Record<AudioMode, TranslationKey> = {
  auto: "export.audioHintAuto",
  voice: "export.audioHintVoice",
  strip: "export.audioHintStrip",
}

/** Yeniden kodlama oranı: profilin kaynak bitrate'ine göre yaklaşık çarpanı. */
const QUALITY_SIZE_RATIO: Record<ExportQuality, number> = {
  high: 0.92,
  balanced: 0.75,
  compact: 0.58,
}

/** Kaynak bitrate'i bilinmiyorsa yüksekliğe göre kaba bitrate (kbps). */
function fallbackBitRateKbps(height: number): number {
  if (height >= 1440) return 9000
  if (height >= 1080) return 4500
  if (height >= 720) return 2500
  if (height >= 480) return 1200
  return 700
}

interface EstimateInput {
  duration: number
  quality: ExportQuality
  sourceBitRateKbps?: number
  sourceHeight?: number
  outputScale?: number | null
  audioMode: AudioMode
}

/**
 * Dışa aktarma öncesi kaba çıktı boyutu tahmini (MB).
 *
 * Kaynak bitrate'i biliniyorsa ondan, bilinmiyorsa yükseklik tablosundan
 * başlanır; profil çarpanı ve ölçek oranının karesi uygulanır. Tahmin yalnızca
 * kullanıcıya kalite/boyut dengesini göstermek için — kesin değer değil.
 */
export function estimateExportSizeMb({
  duration,
  quality,
  sourceBitRateKbps,
  sourceHeight,
  outputScale,
  audioMode,
}: EstimateInput): number | null {
  if (!Number.isFinite(duration) || duration <= 0) return null

  const height = outputScale ?? sourceHeight ?? 1080
  let videoKbps =
    sourceBitRateKbps && sourceBitRateKbps > 0
      ? sourceBitRateKbps
      : fallbackBitRateKbps(height)

  const scale =
    outputScale && sourceHeight && sourceHeight > 0
      ? Math.min(1, outputScale / sourceHeight)
      : 1
  videoKbps = videoKbps * QUALITY_SIZE_RATIO[quality] * scale * scale

  const audioKbps =
    audioMode === "strip" ? 0 : audioMode === "voice" ? 64 : 128
  const megabytes = ((videoKbps + audioKbps) * duration) / 8 / 1024
  return Math.max(0.1, Math.round(megabytes * 10) / 10)
}
