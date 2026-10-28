/** Backend API'si ile paylaşılan veri sözleşmeleri. */

/** Kaynak platformu: doğrudan medya akışı, yerel dosya ya da yt-dlp ile çözülen platform. */
export type SourcePlatform = "direct" | "youtube" | "twitter" | "instagram" | "tiktok" | "ytdlp" | "local"

/** HLS master playlist'indeki WebVTT altyazı rendition'ı. */
export interface HlsSubtitleTrack {
  /** Grup/dil/ad üzerinden kararlı kimlik. */
  id: string
  group_id: string
  name: string
  language?: string | null
  /** Altyazı medya playlist'i (WebVTT parçaları). */
  url: string
  hls?: boolean
  default?: boolean
  autoselect?: boolean
  forced?: boolean
}

/** HLS master playlist'indeki alternatif ses rendition'ı. */
export interface HlsAudioTrack {
  /** Grup/dil/ad üzerinden kararlı kimlik; kalite değişince seçim korunur. */
  id: string
  group_id: string
  name: string
  language?: string | null
  /** Ses playlist'i (genellikle `.m3u8`). */
  url: string
  /** Ses akışı HLS ise hls.js ile bağlanır. */
  hls?: boolean
  /** Video/sitenin varsayılan ses parçası. */
  default?: boolean
  /** Kaynağın özgün dili (YouTube'da dublaj karşılığı değil). */
  original?: boolean
  autoselect?: boolean
  forced?: boolean
}

export interface ResolveResponse {
  success: boolean
  /** Kaynak platformu: "youtube" | "twitter" | "instagram" | "tiktok" | "direct" */
  platform?: SourcePlatform
  is_youtube: boolean
  /** X (Twitter) bağlantısı mı? */
  is_twitter?: boolean
  /** Instagram bağlantısı mı? */
  is_instagram?: boolean
  /** TikTok bağlantısı mı? */
  is_tiktok?: boolean
  /** Kaynak canlı yayın mı? */
  is_live?: boolean
  /** yt-dlp canlı durumu (`is_live`, `was_live`, `not_live`). */
  live_status?: string | null
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
  /** Master playlist'teki alternatif ses rendition'ları (varsa). */
  audio_tracks?: HlsAudioTrack[]
  /** Master playlist'teki WebVTT altyazı rendition'ları (varsa). */
  subtitle_tracks?: HlsSubtitleTrack[]
  /** Kaynak panelindeki kalite listesi (en yüksek kalite başta). */
  variants?: StreamVariant[]
  /** curl ile yapıştırılan başlıklar için proxy belirteci (yalnızca doğrudan kaynak). */
  header_token?: string | null
}

/** Önizleme kalite varyantı (HLS yükseklikleri; 1080p üstü de listelenir). */
export interface StreamVariant {
  url: string
  /** Gerçek piksel yüksekliği (ör. kırpılmış 1080p akışta 800). */
  height: number
  /** Kalite etiketi için yayın sınıfı (ör. 1920x800 → 1080). */
  quality_height?: number
  label: string
  hls: boolean
  /** Varyant kendi sesini taşıyor mu? (null → bilinmiyor) */
  has_audio?: boolean | null
  /** Görüntü-only varyant için ayrı ses akışı adresi. */
  audio_url?: string | null
  /** Varyantın ses grubundaki alternatif rendition'lar. */
  audio_tracks?: HlsAudioTrack[]
  /** Varyantın altyazı grubundaki WebVTT rendition'ları. */
  subtitle_tracks?: HlsSubtitleTrack[]
  /** Ayrı ses akışı HLS ise tarayıcıda hls.js ile bağlanır. */
  audio_hls?: boolean
  /** Varsayılan önizleme varyantı (1080p'yi aşmayan en yüksek kalite). */
  default?: boolean
}

export interface SubtitleResponse {
  success: boolean
  /** Birleştirilmiş WebVTT metni. */
  vtt: string
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
  /** Görüntü akışı var mı? (ses-only dosyalarda false) */
  has_video?: boolean
  /** ffprobe format adı (ör. mov,mp4,m4a,3gp,3g2,mj2). */
  format_name?: string
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
export type ExportQuality = "high" | "balanced" | "compact"
export type ExportCodec = "h264" | "hevc"
export type EncoderChoice = "cpu" | "gpu"
export type JobStatus = "pending" | "running" | "done" | "error" | "cancelled"

/** GPU ve CPU render kuyrukları birbirinden bağımsızdır. */
export type JobLane = "gpu" | "cpu"

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

export interface ExportFeatures {
  /** FFmpeg derlemesinde libx265 varsa H.265 seçilebilir. */
  hevc: boolean
  /** Backend 30 fps çıktı filtresini destekliyorsa true. */
  frame_rate: boolean
}

export interface ExportCapabilities {
  success: boolean
  gpu: GpuCapability
  /** Eski backend'lerde yok; seçenekler bu durumda gizlenir. */
  features?: ExportFeatures
}

export interface ExportSegment {
  start_time: number
  end_time: number
}

export interface ExportRequest {
  url: string
  start_time: number
  end_time: number
  /** Çoklu kesim: verilirse dışa aktarma parçaları sırayla işleyip birleştirir. */
  segments?: ExportSegment[]
  mode: CutMode
  output_format: OutputFormat
  /** Yeniden kodlanan MP4 çıktıları için boyut/kalite dengesi. */
  quality?: ExportQuality
  /** MP4 video kodlayıcısı; H.265 CPU üzerinde kodlanır. */
  codec?: ExportCodec
  /** İsteğe bağlı çıktı kare hızı (ör. 30); kaynak fps korunacaksa null. */
  output_fps?: number | null
  crop: CropPayload | null
  filename: string
  /** Render tercihi; GPU yalnızca uygun MP4 + hassas/kırpmalı işlerde kullanılır. */
  encoder?: EncoderChoice
  /** Video akışı sessizse sesin alınacağı ayrı akış. */
  audio_url?: string | null
  /** curl ile yapıştırılan HTTP başlıkları (cookie/referer…). */
  headers?: Record<string, string> | null
  /** Resolve sonrası dönen CDN başlık belirteci (TikTok Referer gibi). */
  header_token?: string | null
  /**
   * Canlı/DVR zaman çizelgesi bağlantısı: `time` anında `sequence` numaralı
   * segment başlıyor. Pencere kaydığı için backend klip sınırlarını bu
   * segmentin güncel penceredeki konumuna göre taşır.
   */
  anchor?: TimelineAnchorPoint
}

/** İstemci zaman çizelgesinde bilinen bir segment başlangıcı. */
export interface TimelineAnchorPoint {
  /** HLS medya sırası (`EXT-X-MEDIA-SEQUENCE` + index). */
  sequence: number
  /** Segmentin istemci zaman çizelgesindeki başlangıcı (sn). */
  time: number
}

/** Bir HLS penceresinin zaman çizelgesi ↔ medya sırası haritası. */
export interface TimelineAnchor {
  /** Pencerenin ilk segmentinin medya sırası. */
  start_sequence: number
  /** İlk segmentin zaman çizelgesindeki başlangıcı (sn). */
  start_time: number
  /** Segmentlerin süreleri (ilk segmentten itibaren, sn). */
  durations: number[]
}

export interface ExportJob {
  id: string
  status: JobStatus
  progress: number
  created_at: number
  output_filename?: string
  /** İş kuyrukta beklerken kartta gösterilen hedef dosya adı. */
  requested_filename?: string | null
  clip_duration?: number
  /** Klibin kaynak üzerindeki başlangıç/bitiş saniyeleri (paralel iş kartları). */
  clip_start?: number
  clip_end?: number
  /** Çıktı biçimi ve kesim modu (kart başlığında gösterilir). */
  output_format?: string
  mode?: string
  quality?: string
  codec?: string
  output_fps?: number | null
  /** İşin render kuyruğu: GPU ve CPU işleri ayrı kuyruklarda sırayla çalışır. */
  lane?: JobLane
  /** Bekleyen işin kendi kuyruğundaki 1 tabanlı sırası. */
  queue_position?: number
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
  /** FFmpeg hızına göre yaklaşık kalan saniye. */
  eta_sec?: number
  current_sec?: number
  error?: string
  command?: string
}

/** `GET /api/jobs` — bellek içi iş merkezindeki işler (en eski önce). */
export interface JobsResponse {
  success: boolean
  jobs: ExportJob[]
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
  /** Üretim ayarlardan kapalı ve önbellekte kayıt yok: çizim yapılmaz. */
  skipped?: boolean
  /** `skipped` ise nedeni (`disabled`). Kullanıcıya gösterilen metin değildir. */
  reason?: string
  error?: string
}

export interface WaveformStartEvent {
  type: "start"
  duration: number
  bucket_seconds: number
  bucket_count: number
  optimized: boolean
  cached: boolean
  silent?: boolean
}

export interface WaveformChunkEvent {
  type: "chunk"
  index: number
  /** Global kova başlangıç indeksi. */
  start: number
  /** Bu olaydaki kova sayısı. */
  count: number
  /** base64 kodlanmış kova baytları. */
  buckets: string
}

export interface WaveformDoneEvent {
  type: "done"
  success: boolean
  duration: number
  bucket_seconds: number
  bucket_count: number
  cached: boolean
  optimized: boolean
  silent?: boolean
}

export interface WaveformErrorEvent {
  type: "error"
  error: string
  status_code?: number
}

/** Üretim kapalı ve önbellek yok: istek indirme/FFmpeg'e girmeden biter. */
export interface WaveformSkippedEvent {
  type: "skipped"
  /** `disabled` — ayarlardan dalga formu üretimi kapatıldı. */
  reason: string
}

export type WaveformStreamEvent =
  | WaveformStartEvent
  | WaveformChunkEvent
  | WaveformDoneEvent
  | WaveformErrorEvent
  | WaveformSkippedEvent

/** `POST /api/storyboard` — 10 karelik kademeli önizleme grubu. */
export interface StoryboardBatchMeta {
  success: boolean
  /** Storyboard'un kapsadığı süre (sn). */
  duration: number
  /** Kareler arasındaki süre (sn, en az 2). */
  interval: number
  tile_width: number
  tile_height: number
  /** Toplam hedef kare sayısı (en fazla 100). */
  count: number
  batch_size: number
  total_batches: number
  /** Bu grubun sırası (0 tabanlı). */
  batch: number
  batch_count: number
  /** Son grup yüklendiyse true. */
  complete: boolean
  /** Bu sprite'ın sütun/satır sayısı. */
  columns: number
  rows: number
  /** Gruptaki karelerin toplam storyboard indeksleri. */
  indices: number[]
  /** Gruptaki karelerin kaynaktaki zamanları (sn). */
  times: number[]
  /** Uzun ömürlü önbellekli JPEG sprite adresi. */
  sheet_url: string
  /** Disk önbelleği anahtarı. */
  source_key: string
  created_at: number
  cached: boolean
  /** HLS'te hafif varyant kullanıldıysa true. */
  optimized: boolean
  error?: string
}

/** İstemcide yüklenen storyboard gruplarının birleşik görünümü. */
export interface StoryboardMeta {
  duration: number
  interval: number
  tile_width: number
  tile_height: number
  /** Toplam hedef kare sayısı. */
  count: number
  complete: boolean
  batches: StoryboardBatchMeta[]
}

export interface ExportFile {
  name: string
  size_mb: number
  modified: number
  modified_str: string
  url: string
}

/** `GET /api/library/{filename}/meta` — ffprobe tabanlı medya ayrıntıları. */
export interface LibraryFileMeta {
  success: boolean
  name: string
  duration: number
  width: number
  height: number
  fps: number
  codec: string
  has_audio: boolean
  has_video: boolean
  format_name: string
  size_bytes: number
  size_mb: number
  /** Sonuç süreç önbelleğinden mi geldi? */
  cached: boolean
}

/** Canlı kayıt durumu: yakalanıyor veya duraklatıldı.
 *
 * Bitmiş kayıt diye bir durum yoktur: segmentler doğrudan proje akışına
 * yazıldığı için kayıt biter bitmez akışın bir bloğu olur.
 */
export type RecordingStatus = "recording" | "paused"

/** Canlı yayın kaydı (`/api/recordings`) — yalnızca süren kayıtlar. */
export interface Recording {
  id: string
  title: string
  status: RecordingStatus
  /** Unix zaman damgası (sn). */
  created_at: number
  updated_at: number
  /** Yakalanan medya süresi (sn). */
  duration: number
  /** Yakalanan segment sayısı. */
  segments: number
  bytes: number
  size_mb: number
  /** Pencere kaydığı için kaçırılan segment sayısı. */
  gaps: number
  error: string | null
  /** Süre/boyut sınırına takıldı mı? */
  limit_reached: boolean
  /** Kaydı başlatan proje kimliği (kayıtlar projeye özeldir). */
  project_id?: string | null
  /** Segmentlerin yazıldığı akış (proje kimliği). */
  stream_id: string
}

/** `POST /api/recordings` gövdesi. */
export interface StartRecordingRequest {
  url: string
  title?: string
  headers?: Record<string, string> | null
  header_token?: string | null
  /** Segmentlerin yazılacağı proje/akış kimliği. */
  project_id: string
}

/** Akıştaki tek blok: bir kaydın ard arda segmentleri (zaman çizelgesi). */
export interface StreamBlock {
  /** Bloğu üreten kayıt; silme bu kimlikle yapılır. */
  recording_id: string
  title: string
  /** Akış zamanında başlangıç/bitiş (sn). */
  start: number
  end: number
  segments: number
  bytes: number
  created_at: number
}

/** Proje akışı (`/api/streams/<proje>`): kayıtların ard arda eklendiği akış. */
export interface StreamSummary {
  id: string
  project_id: string | null
  title: string | null
  /** Toplam süre (sn); segment sürelerinin toplamı. */
  duration: number
  segments: number
  bytes: number
  size_mb: number
  created_at: number
  updated_at: number
  width: number
  height: number
  fps: number
  has_audio: boolean
  /** HLS playlist adresi (tarayıcı + ffmpeg). */
  url: string
  /** Segment sayısı: her ekleme/silme yeni bir sürüm demektir. */
  revision: number
  /**
   * Yıkıcı değişim sayacı (blok silme). Oynatma adresi buna göre tazelenir;
   * kayıt eklemek sayacı değiştirmez, böylece video yeniden yüklenmez.
   */
  playback: number
  blocks: StreamBlock[]
}
