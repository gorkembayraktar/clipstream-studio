/** Backend API'si ile paylaşılan veri sözleşmeleri. */

/** Kaynak platformu: doğrudan medya akışı, yerel dosya ya da yt-dlp ile çözülen platform. */
export type SourcePlatform = "direct" | "youtube" | "twitter" | "instagram" | "local"

export interface ResolveResponse {
  success: boolean
  /** Kaynak platformu: "youtube" | "twitter" | "instagram" | "direct" */
  platform?: SourcePlatform
  is_youtube: boolean
  /** X (Twitter) bağlantısı mı? */
  is_twitter?: boolean
  /** Instagram bağlantısı mı? */
  is_instagram?: boolean
  is_m3u8: boolean
  stream_url: string
  original_url?: string
  title?: string
  duration?: number
  resolution?: string
  is_ytdlp_missing?: boolean
  /** Video akışı ses içeriyor mu? (null → bilinmiyor) */
  has_audio?: boolean | null
  /** Video akışı sessizse kullanılacak ses-yalnız akış adresi. */
  audio_url?: string | null
  /** Kaynak panelindeki kalite listesi (en yüksek kalite başta). */
  variants?: StreamVariant[]
  /** curl ile yapıştırılan başlıklar için proxy belirteci (yalnızca doğrudan kaynak). */
  header_token?: string | null
}

/** Önizleme kalite varyantı (HLS yükseklikleri; 1080p üstü de listelenir). */
export interface StreamVariant {
  url: string
  height: number
  label: string
  hls: boolean
  /** Varyant kendi sesini taşıyor mu? (null → bilinmiyor) */
  has_audio?: boolean | null
  /** Görüntü-only varyant için ayrı ses akışı adresi. */
  audio_url?: string | null
  /** Varsayılan önizleme varyantı (1080p'yi aşmayan en yüksek kalite). */
  default?: boolean
}

export interface ProbeResponse {
  success: boolean
  duration: number
  size_mb: number
  size_bytes: number
  width: number
  height: number
  /** Kare hızı (kare adımı için); 0 → bilinmiyor. */
  fps: number
  codec: string
  has_audio: boolean
}

/** Yerel dosya yükleme / seçme yanıtı. */
export interface LocalFileResponse {
  success: true
  /** Özgün dosya adı (metadata). */
  name: string
  /** Tarayıcının oynatacağı mutlak adres (`http://127.0.0.1:8765/...`). */
  url: string
  /** Kopyasız seçimde özgün dosya yolu (sürükle-bırakta null). */
  path?: string | null
  width: number
  height: number
  duration: number
  fps: number
  has_audio: boolean
  size_bytes: number
  size_mb: number
  /** Tarayıcı kabı desteklemediği için remux yapıldı mı? */
  remuxed: boolean
}

/** Kullanıcı işlemi iptal etti (hata değil). */
export type LocalCancelledResponse = { success: false; cancelled: true }

/** `POST /api/local/pick` yanıtı: başarılı kaynak ya da iptal. */
export type LocalPickResponse = LocalFileResponse | LocalCancelledResponse

/** `POST /api/local/upload` yanıtı: başarılı kaynak ya da iptal. */
export type LocalUploadResponse = LocalFileResponse | LocalCancelledResponse

export interface VideoMeta {
  width: number
  height: number
  duration: number
  hasAudio: boolean
  /** Kare hızı (kare adımı için); yoksa varsayılan kullanılır. */
  fps?: number
}

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CropPayload extends CropRect {
  enabled: boolean
  source_width: number
  source_height: number
}

export type AspectPreset = "free" | "16:9" | "9:16" | "1:1" | "4:5"
export type CutMode = "fast" | "exact"
export type OutputFormat = "mp4" | "gif" | "mp3"
export type EncoderChoice = "cpu" | "gpu"
export type JobStatus = "pending" | "running" | "done" | "error" | "cancelled"

/** `GET /api/export/capabilities` — gerçek GPU kodlayıcı probe sonucu. */
export interface GpuCapability {
  available: boolean
  /** Çalışan FFmpeg kodlayıcısı: h264_nvenc | h264_qsv | h264_amf. */
  encoder: string | null
  label: string | null
  /** Kullanılamıyorsa seçili dilde neden. */
  reason: string | null
  /** Sürücü/FFmpeg ayrıntısı (teknik, isteğe bağlı). */
  detail: string | null
}

export interface ExportCapabilities {
  success: boolean
  gpu: GpuCapability
}

export interface ExportRequest {
  url: string
  start_time: number
  end_time: number
  mode: CutMode
  output_format: OutputFormat
  crop: CropPayload | null
  filename: string
  /** Render tercihi; GPU yalnızca uygun MP4 + hassas/kırpmalı işlerde kullanılır. */
  encoder?: EncoderChoice
  /** Video akışı sessizse sesin alınacağı ayrı akış. */
  audio_url?: string | null
  /** curl ile yapıştırılan HTTP başlıkları (cookie/referer…). */
  headers?: Record<string, string> | null
}

export interface ExportJob {
  id: string
  status: JobStatus
  progress: number
  created_at: number
  output_filename?: string
  clip_duration?: number
  /** Klibin kaynak üzerindeki başlangıç/bitiş saniyeleri (paralel iş kartları). */
  clip_start?: number
  clip_end?: number
  /** Çıktı biçimi ve kesim modu (kart başlığında gösterilir). */
  output_format?: string
  mode?: string
  /** İstenen ve gerçekleşen render yolu. */
  encoder_requested?: EncoderChoice
  encoder_used?: EncoderChoice
  gpu_encoder?: string | null
  gpu_label?: string | null
  /** GPU kullanılamadı/başarısız oldu ve CPU'ya dönüldü. */
  gpu_fallback?: boolean
  gpu_fallback_reason?: string | null
  gpu_fallback_detail?: string | null
  size_mb?: number
  elapsed_sec?: number
  speed?: string
  current_sec?: number
  error?: string
  command?: string
}

export interface WaveformResponse {
  success: boolean
  /** Kova başına saniye (0,25 sn veya uzun kaynakta otomatik seyreltme). */
  bucket_seconds: number
  bucket_count: number
  /** Çıkarımın kapsadığı süre (sn). */
  duration: number
  /** base64 ile kodlanmış, her baytı bir kova (0–255) olan tepe değerleri. */
  buckets: string
  cached: boolean
  /** Ses grubu/hafif varyant kullanıldıysa true. */
  optimized: boolean
  /** Kaynakta ses akışı yok (sessiz video): dalga formu çizilmez. */
  silent?: boolean
  error?: string
}

export interface ExportFile {
  name: string
  size_mb: number
  modified: number
  modified_str: string
  url: string
}
