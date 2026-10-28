/** Sahne: video elementi + olay bağlama + overlay'ler. */
import { useCallback, useEffect, useRef } from "react"

import { Clapperboard, Loader2 } from "lucide-react"
import type HlsJs from "hls.js"
import { toast } from "sonner"

import { CropMenu } from "@/components/app/crop-menu"
import { CropOverlay } from "@/components/app/crop-overlay"
import { StageControls } from "@/components/app/stage-controls"
import { StreamStatusBadge } from "@/components/app/stream-status-badge"
import { useHlsSource } from "@/hooks/use-hls-source"
import { useSubtitleVtt } from "@/hooks/use-subtitles"
import { useFullscreen } from "@/hooks/use-fullscreen"
import { translate, useI18n } from "@/i18n"
import { formatTime } from "@/lib/format"
import { isHlsUrl, proxiedUrl } from "@/lib/media"
import { gapsOf, useEditStore } from "@/stores/edit-store"
import { log } from "@/stores/log-store"
import { usePlayerStore } from "@/stores/player-store"
import { useRecorderStore } from "@/stores/recorder-store"
import { useSourceStore } from "@/stores/source-store"

/** "Kare Yüklendi" bildiriminin ekranda kalma süresi (ms). */
const SEEK_NOTE_MS = 1200

/** Ses akışı seek sonrası veri beklerken göstergenin görünmesi için eşik (ms).
 *
 * Kısa duraklamalarda (önbellekteki bölge, hızlı CDN) gösterge yanıp sönmesin. */
const AUDIO_BUFFER_HINT_MS = 450

/** Proje akışı (EVENT playlist) sonunda `ended` gelmez; uçta tıkanma bu süre
 * sonra "bitti" sayılır (yoksa arabellek göstergesi sonsuza dek kalır). */
const END_STALL_MS = 500

export function VideoStage() {
  const { t } = useI18n()
  const videoRef = useRef<HTMLVideoElement>(null)
  /** Aynı meta veriyi tekrar tekrar loglamamak için son kaydedilen boyut/süre. */
  const metaLoggedRef = useRef<string | null>(null)
  /** Arabelleğe alma kaydının spam olmaması için bayrak. */
  const bufferingLoggedRef = useRef(false)
  const streamUrl = useSourceStore((s) => s.streamUrl)
  const useProxy = useSourceStore((s) => s.useProxy)
  const platform = useSourceStore((s) => s.platform)
  const audioUrl = useSourceStore((s) => s.audioUrl)
  const audioTrackId = useSourceStore((s) => s.audioTrackId)
  const audioSwitching = useSourceStore((s) => s.audioSwitching)
  const setAudioSwitching = useSourceStore((s) => s.setAudioSwitching)
  const audioBuffering = useSourceStore((s) => s.audioBuffering)
  const setAudioBuffering = useSourceStore((s) => s.setAudioBuffering)
  const subtitleTracks = useSourceStore((s) => s.subtitleTracks)
  const subtitleTrackId = useSourceStore((s) => s.subtitleTrackId)
  const headers = useSourceStore((s) => s.headers)
  const variants = useSourceStore((s) => s.variants)
  const sourceIsHls = useSourceStore((s) => s.isHls)
  const headerToken = useSourceStore((s) => s.headerToken)
  const previewHeight = useSourceStore((s) => s.previewHeight)
  const cropEnabled = useEditStore((s) => s.crop.enabled)
  const isStreamSource = useSourceStore((s) => Boolean(s.streamId))
  const liveUrl = useSourceStore((s) => s.liveUrl)
  const previewLiveFlag = useSourceStore((s) => s.previewLive)
  /**
   * Kayıt alındıktan sonra sahne proje akışını gösterir. "Canlı" düğmesi
   * `previewLive` ile görüntüyü canlı yayına alır; kaynak/kimlik değişmez,
   * yalnızca oynatılan adres değişir.
   */
  const livePreview = previewLiveFlag && Boolean(liveUrl)
  const setMeta = useSourceStore((s) => s.setMeta)
  const setTimelineAnchor = useSourceStore((s) => s.setTimelineAnchor)
  const markLive = usePlayerStore((s) => s.markLive)

  // Önizleme kalitesi: seçili varyant (seçim yoksa kaynağın en yükseği).
  // Dışa aktarma, dalga formu ve analiz her zaman kaynağın en yüksek kalitesini
  // (streamUrl/audioUrl) kullanır; burada yalnızca oynatma kaynağı değişir.
  const previewVariant =
    variants.find((item) => (item.quality_height ?? item.height) === previewHeight) ??
    variants[0] ??
    null
  const previewStreamUrl = previewVariant?.url ?? streamUrl
  // Kalite değişse de seçili ses rendition'ı kararlı kimlikle eşlenir; o
  // varyantta yoksa mağazadaki seçili ses adresine, o da yoksa varyantın
  // varsayılan sesine düşülür (seçim hiçbir durumda kaybolmaz).
  const previewAudioTrack =
    previewVariant?.audio_tracks?.find((track) => track.id === audioTrackId) ??
    previewVariant?.audio_tracks?.find((track) => track.default) ??
    null
  const previewAudioUrl = previewVariant
    ? (previewAudioTrack?.url ?? audioUrl ?? previewVariant.audio_url ?? null)
    : audioUrl
  /** Seçili varyantın HLS bilgisi; varyant yoksa kaynak seviyesindeki tespit. */
  const playerIsHls = previewVariant?.hls ?? sourceIsHls

  // YouTube/X/Instagram akışları tarayıcıdan doğrudan çalınamaz (CORS) → proxy otomatik.
  // Yerel dosyalar (/uploads/...) aynı sunucudan geldiği için proxy gerekmez.
  // curl ile başlık verildiyse tarayıcı bunları gönderemez → proxy zorunlu.
  const needsProxy =
    useProxy || (platform !== "direct" && platform !== "local") || Boolean(headerToken)
  /** Canlı önizlemede sahne yayını, aksi hâlde kaydedilmiş akışı oynatır. */
  const basePlayerSrc = livePreview ? liveUrl : previewStreamUrl
  const playerSrc = basePlayerSrc
    ? needsProxy
      ? proxiedUrl(basePlayerSrc, headerToken)
      : basePlayerSrc
    : null
  const audioSrc = previewAudioUrl
    ? needsProxy
      ? proxiedUrl(previewAudioUrl, headerToken)
      : previewAudioUrl
    : null
  /** Ses akışı HLS (ör. ayrı ses grubu) ise `src` yerine hls.js ile bağlanır. */
  const audioIsHls = Boolean(
    audioSrc &&
      (previewAudioTrack?.hls ||
        (previewVariant?.audio_hls ?? false) ||
        isHlsUrl(audioSrc)),
  )
  /**
   * Canlı uç bildirimi.
   *
   * Proje akışı her zaman VOD'dur: hls.js `details.live` görse bile canlı mod
   * açılmaz (yoksa zaman çizelgesi düzenlenemez hâle gelir). Kaynak canlıdan
   * akışa geçtiğinde `null` bildirimi yine geçirilir ki eski canlı mod kapansın.
   */
  const handleLiveEdge = useCallback(
    (edge: number | null) => {
      const source = useSourceStore.getState()
      if (edge !== null && source.streamId && !source.previewLive) return
      markLive(edge)
    },
    [markLive],
  )

  /** Canlı/DVR hizalama haritası; proje akışı canlı olmadığı için bildirilmez. */
  const handleTimelineAnchor = useCallback(
    (anchor: Parameters<typeof setTimelineAnchor>[0]) => {
      const source = useSourceStore.getState()
      if (source.streamId && !source.previewLive) return
      setTimelineAnchor(anchor)
    },
    [setTimelineAnchor],
  )

  useHlsSource(
    videoRef,
    playerSrc,
    playerIsHls,
    handleTimelineAnchor,
    handleLiveEdge,
    // Proje akışı büyüyen EVENT listesidir: canlı uca atlamadan baştan başla.
    // Canlı önizlemede ise oynatma canlı uçtan başlar.
    isStreamSource && !livePreview,
  )

  // Önizleme varyantında aynı altyazı grubu varsa onu, yoksa kaynağın
  // varsayılan varyantındaki rendition'ı kullan.
  const previewSubtitleTrack = subtitleTrackId
    ? (previewVariant?.subtitle_tracks?.find(
        (track) => track.id === subtitleTrackId,
      ) ??
      subtitleTracks.find((track) => track.id === subtitleTrackId) ??
      null)
    : null
  const {
    src: subtitleSrc,
    error: subtitleError,
  } = useSubtitleVtt(previewSubtitleTrack, headers)

  useEffect(() => {
    if (!subtitleError) return
    toast.warning(translate("log.subtitleLoadFailed"), {
      description: subtitleError.message,
    })
  }, [subtitleError])

  /** Blob VTT yüklendiğinde yalnızca kendi altyazı track'imizi görünür yap. */
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    const target = Array.from(el.textTracks).find(
      (track) => track.id === "clipstream-subtitle",
    )
    if (target) target.mode = subtitleSrc ? "showing" : "disabled"
  }, [subtitleSrc, playerSrc])

  const audioRef = useRef<HTMLAudioElement>(null)
  /** Kullanıcı oynatmak istiyor mu? Tarayıcının kendiliğinden duraklatmasını ayırt eder. */
  const wantsPlayRef = useRef(false)
  /** Kalite değişiminde konumu korumak için bekleyen geçiş bilgisi. */
  const pendingSwitchRef = useRef<{ time: number; playing: boolean } | null>(null)
  const lastPreviewHeightRef = useRef<number | null>(previewHeight)

  /** Kalite değişince aynı konumdan devam etmek için konum/oynatma durumu saklanır. */
  useEffect(() => {
    const previous = lastPreviewHeightRef.current
    lastPreviewHeightRef.current = previewHeight
    if (previous === null || previous === previewHeight) return
    const player = usePlayerStore.getState()
    if (player.duration > 0) {
      pendingSwitchRef.current = { time: player.currentTime, playing: player.playing }
    }
  }, [previewHeight])

  /** Ses akışı HLS (m3u8) ise hls.js ses elementine bağlanır (ör. X ses rendition'ları).
   *
   * Chrome m3u8'i yerel olarak oynatmadığı için ses de hls.js ile beslenir;
   * bu sayede görüntü-only HLS kaynaklarında da ses duyulur. */
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !audioSrc || !audioIsHls) return

    let hls: HlsJs | null = null
    let disposed = false

    const setup = async () => {
      const { default: Hls } = await import("hls.js")
      if (disposed || !Hls.isSupported()) return
      log("info", translate("hls.audioConnecting"))
      hls = new Hls({ enableWorker: true })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || !hls) return
        const response = (
          data as {
            response?: { code?: number; text?: string }
          }
        ).response
        const code = response?.code
        const details = String(data.details)
        log("error", translate("log.audioHlsError"), details)
        if (code === 401 || code === 403) {
          toast.error(translate("hls.errorForbiddenTitle"), {
            description: translate("hls.errorForbidden", { status: code }),
          })
        } else if (code === 404) {
          toast.error(translate("hls.errorNotFoundTitle"), {
            description: translate("hls.errorNotFound"),
          })
        } else if (code === 429) {
          toast.error(translate("hls.errorRateLimitedTitle"), {
            description: translate("hls.errorRateLimited"),
          })
        } else if (code && code >= 500) {
          toast.warning(translate("hls.errorServerTitle"), {
            description: translate("hls.errorServer", { status: code }),
          })
        } else if (!code && details.toLowerCase().includes("codec")) {
          toast.error(translate("hls.errorCodecTitle"), {
            description: translate("hls.errorCodec"),
          })
        } else if (!code) {
          toast.error(translate("hls.errorCorsTitle"), {
            description: translate("hls.errorCors"),
          })
        }
        hls.destroy()
        hls = null
      })
      hls.loadSource(audioSrc)
      hls.attachMedia(audio)
    }
    void setup()

    return () => {
      disposed = true
      hls?.destroy()
    }
  }, [audioSrc, audioIsHls])

  /** Video akışı sessizse ses ayrı akıştan gelir; duyulabilir olan ses esas alınır.
   *
   * Altın kural: **kendiliğinden oluşan kaymada ses geri sarılmaz.** Video
   * donduğunda sesi geri sarmak aynı bölümün tekrar duyulmasına ("çift ses")
   * yol açar; bunun yerine geride kalan taraf ileri alınır. Kullanıcının zaman
   * çizelgesinden sardığı konum ise her iki yönde de esastır (bkz. guardSeek). */
  useEffect(() => {
    const video = videoRef.current
    const audio = audioRef.current
    if (!video || !audio || !audioSrc) return

    // Kısa bir "oturma" penceresi: kendi tetiklediğimiz düzeltmeyi tekrar düzeltmeyelim.
    let settleUntil = 0
    const settle = () => {
      settleUntil = performance.now() + 700
    }
    /** Kullanıcı zaman çizelgesinden sardığında görüntü konumu esastır: ses
     * yeni konuma oturmamış olsa bile video geri/ileri çekilmez. */
    let seekGuardUntil = 0
    const guardSeek = () => {
      seekGuardUntil = performance.now() + 2000
    }
    const seekTo = (element: HTMLMediaElement, time: number) => {
      try {
        element.currentTime = time
      } catch {
        /* meta verisi henüz hazır değilse yok sayılır */
      }
    }
    /** Sesi ileri alır (video ileride kaldıysa). */
    const advanceAudio = () => {
      if (performance.now() < settleUntil) return
      settle()
      seekTo(audio, video.currentTime)
    }
    /** Görüntüyü ileri alır (ses ileride kaldıysa; ör. sekme arka plandayken donduysa). */
    const advanceVideo = () => {
      if (performance.now() < settleUntil) return
      // Kullanıcı sarması yeni tamamlandıysa sesin oturmasını bekle.
      if (performance.now() < seekGuardUntil) return
      settle()
      seekTo(video, audio.currentTime)
    }
    const resumeAudio = () => {
      if (video.muted) return
      void audio.play().catch(() => undefined)
    }

    /** Seek sonrası ses, yeni konumun verisini proxy'den bekler. Kısa
     * duraklamalarda gösterge yakmamak için 450 ms eşik uygulanır. */
    let bufferingHint = 0
    const clearAudioBuffering = () => {
      if (bufferingHint) {
        window.clearTimeout(bufferingHint)
        bufferingHint = 0
      }
      setAudioBuffering(false)
    }
    const onAudioWaiting = () => {
      if (bufferingHint) return
      // Duraklatılmış/sessiz oynatmada beklemeyi bildirmenin anlamı yok.
      if (video.paused || video.muted || video.ended) return
      bufferingHint = window.setTimeout(() => {
        bufferingHint = 0
        if (!audio.paused && !video.paused && audio.readyState < 3) {
          setAudioBuffering(true)
        }
      }, AUDIO_BUFFER_HINT_MS)
    }

    /** Yeni ses kaynağı hazır olduğunda konumu eşitle ve gerekirse oynat.
     *
     * Ses parçası değişince <audio> yeni `src` ile baştan yüklenir; video ise
     * oynamaya devam eder. Video elementi yeniden `play` olayı üretmediği için
     * ses kendiliğinden başlamaz — burada devreye alınır. */
    let syncedForSrc = false
    const syncOnReady = () => {
      const first = !syncedForSrc
      syncedForSrc = true
      audio.playbackRate = video.playbackRate
      audio.volume = video.volume
      audio.muted = video.muted
      // İlk yüklemede her zaman, sonraki hazır olaylarında yalnızca kayma varsa.
      if (first || Math.abs(audio.currentTime - video.currentTime) > 0.4) {
        seekTo(audio, video.currentTime)
      }
      if (!video.paused && !video.ended && !video.muted) {
        settle()
        void audio.play().catch(() => undefined)
      }
    }
    audio.addEventListener("loadedmetadata", syncOnReady)
    audio.addEventListener("canplay", syncOnReady)

    /** Yalnızca ileri yönde hizalar: hiçbir taraf geri sarılmaz (aynı bölüm tekrar duyulmaz). */
    const forwardSync = () => {
      if (performance.now() < settleUntil) return
      const drift = audio.currentTime - video.currentTime
      if (drift < -0.35) {
        // Ses geride kaldı → ileri al.
        advanceAudio()
      } else if (drift > 0.35) {
        // Görüntü geride kaldı → görüntüyü ileri al; ses geri sarılmaz.
        advanceVideo()
      }
    }

    /** Oynatma sırasında çıkarılmış aralıkları atlar: duyulan = dışa aktarılan. */
    const skipGap = () => {
      const { segments, trim } = useEditStore.getState()
      if (segments.length === 0) return false
      const gap = gapsOf(segments, trim).find(
        (item) => video.currentTime >= item.start && video.currentTime < item.end,
      )
      if (!gap) return false
      guardSeek()
      video.currentTime = gap.end
      return true
    }

    const onPlay = () => {
      wantsPlayRef.current = true
      audio.playbackRate = video.playbackRate
      audio.volume = video.volume
      audio.muted = video.muted
      skipGap()
      forwardSync()
      resumeAudio()
    }
    const onPause = () => {
      // Sekme gizliyken Chrome, sesi olmayan (görüntü-only) akışı kendiliğinden
      // duraklatır: ses devam etmeli, görüntü sekmeye dönüldüğünde telafi edilir.
      if (document.hidden && !video.ended) return
      wantsPlayRef.current = false
      audio.pause()
    }
    const onEnded = () => {
      wantsPlayRef.current = false
      audio.pause()
    }
    const onSeeking = () => {
      guardSeek()
      audio.pause()
    }
    const onSeeked = () => {
      guardSeek()
      // Kullanıcı sarması her iki yönde geçerlidir: ses konumu görüntüye eşitlenir
      // (geri sarma kuralı yalnızca kendiliğinden oluşan kaymalar içindir).
      seekTo(audio, video.currentTime)
      if (!video.paused) resumeAudio()
    }
    const onRateChange = () => {
      audio.playbackRate = video.playbackRate
    }
    /** Ses akışı koptuğunda element baştan yüklenir ve görüntü konumuna hizalanır. */
    let lastAudioRescue = 0
    const onAudioError = () => {
      if (performance.now() < settleUntil) return
      lastAudioRescue = performance.now()
      settle()
      log("warn", translate("log.audioDisconnected"))
      audio.load()
      seekTo(audio, video.currentTime)
      if (!video.paused && !video.muted) void audio.play().catch(() => undefined)
    }
    /** Ses kendiliğinden durduysa (akış kesintisi): geri sarmadan toparlan. */
    const onAudioPause = () => {
      if (document.hidden || video.paused || video.ended || video.muted) return
      // Bilinçli duraklatmalar (kullanıcı sarması, arabellek beklemesi) geri alınmaz.
      if (video.seeking || video.readyState < 3) return
      if (performance.now() < settleUntil) return
      if (performance.now() - lastAudioRescue < 800) return
      lastAudioRescue = performance.now()
      // Ses ileride kaldıysa geri sarmak yerine görüntü ileri alınır.
      const drift = audio.currentTime - video.currentTime
      if (drift > 0.35) advanceVideo()
      resumeAudio()
    }
    const onVolumeChange = () => {
      audio.volume = video.volume
      audio.muted = video.muted
    }
    /** Görüntü arabellekten sonra yeniden oynamaya başlarken sesi de sürdür. */
    const onPlaying = () => {
      if (audio.paused) resumeAudio()
    }
    const onTimeUpdate = () => {
      if (video.paused) return
      if (skipGap()) return
      const drift = audio.currentTime - video.currentTime
      if (drift < -0.35) {
        // Ses geride kaldı → ileri al (geri sarma yok, tekrar duyulmaz).
        advanceAudio()
      } else if (drift > 0.35 && video.readyState >= 3) {
        // Görüntü geride kaldı → görüntüyü ileri al; ses geri sarılmaz.
        advanceVideo()
      }
    }

    // Arka plan/donma bekçisi: gizli sekmede oynatmayı sürdürmeyi denenir; görünürken
    // görüntü arabellek bekliyorsa ses de duraklatılır (tek dosya oynatıcı davranışı).
    let lastTime = video.currentTime
    let frozenSince = 0
    let lastResumeAttempt = 0
    let doubleAudioWarned = false
    /** Video elementinin kendi sesi duyuluyorsa ayrı ses akışı sürdürülmez. */
    let videoHasOwnAudio = false
    const watchdog = window.setInterval(() => {
      if (!wantsPlayRef.current || video.ended) return

      // Emniyet kemeri: video elementinin kendi ses akışı varsa (has_audio yanlış
      // bilinmişse) ayrı ses elementi kapatılır; iki kaynak birlikte çalınamaz.
      const decodedAudio = (video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number })
        .webkitAudioDecodedByteCount
      if (typeof decodedAudio === "number" && decodedAudio > 0) {
        videoHasOwnAudio = true
        if (!audio.paused) {
          audio.pause()
          if (!doubleAudioWarned) {
            doubleAudioWarned = true
            log(
              "warn",
              translate("log.doubleAudioStopped"),
            )
          }
          return
        }
      }

      const now = performance.now()

      // Ölü ses elementi kurtarma: akış koptuysa (readyState 0 / error) yeniden
      // yüklenip görüntü konumuna hizalanır; aksi halde sessiz kalır.
      if (
        !document.hidden &&
        !video.paused &&
        !video.muted &&
        !video.seeking &&
        (audio.readyState === 0 || audio.error) &&
        now - lastAudioRescue > 2000
      ) {
        lastAudioRescue = now
        settle()
        log("warn", translate("log.audioUnresponsive"))
        audio.load()
        seekTo(audio, video.currentTime)
        void audio.play().catch(() => undefined)
      }

      // Ses parçası değişince yeni akış kendiliğinden başlamayabilir (video
      // oynamaya devam ettiği için `play` olayı tekrar gelmez): toparla.
      if (
        !document.hidden &&
        !videoHasOwnAudio &&
        !video.paused &&
        !video.seeking &&
        !video.muted &&
        audio.paused &&
        audio.readyState >= 2
      ) {
        resumeAudio()
      }

      const advanced = Math.abs(video.currentTime - lastTime) > 0.05
      lastTime = video.currentTime

      if (advanced) {
        frozenSince = 0
        return
      }
      if (!frozenSince) {
        frozenSince = now
        return
      }
      if (now - frozenSince < 1200) return

      if (document.hidden) {
        // Chrome sesi olmayan videoyu arka planda duraklatır → yeniden başlatmayı dene.
        if (video.paused && now - lastResumeAttempt > 1000) {
          lastResumeAttempt = now
          void video.play().catch(() => undefined)
        }
        return
      }

      if (!audio.paused && video.readyState < 3) audio.pause()
    }, 500)

    /** Sekmeye dönüldüğünde: görüntüyü sesin konumuna getir ve oynatmayı sürdür. */
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return
      if (!wantsPlayRef.current || video.ended) return
      if (
        performance.now() >= seekGuardUntil &&
        audio.currentTime - video.currentTime > 0.35
      ) {
        seekTo(video, audio.currentTime)
      }
      if (video.paused) void video.play().catch(() => undefined)
      if (audio.paused) resumeAudio()
    }

    video.addEventListener("play", onPlay)
    video.addEventListener("pause", onPause)
    video.addEventListener("ended", onEnded)
    video.addEventListener("playing", onPlaying)
    video.addEventListener("seeking", onSeeking)
    video.addEventListener("seeked", onSeeked)
    video.addEventListener("ratechange", onRateChange)
    video.addEventListener("volumechange", onVolumeChange)
    video.addEventListener("timeupdate", onTimeUpdate)
    audio.addEventListener("error", onAudioError)
    audio.addEventListener("pause", onAudioPause)
    audio.addEventListener("waiting", onAudioWaiting)
    audio.addEventListener("playing", clearAudioBuffering)
    audio.addEventListener("canplay", clearAudioBuffering)
    audio.addEventListener("error", clearAudioBuffering)
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      window.clearInterval(watchdog)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      video.removeEventListener("play", onPlay)
      video.removeEventListener("pause", onPause)
      video.removeEventListener("ended", onEnded)
      video.removeEventListener("playing", onPlaying)
      video.removeEventListener("seeking", onSeeking)
      video.removeEventListener("seeked", onSeeked)
      video.removeEventListener("ratechange", onRateChange)
      video.removeEventListener("volumechange", onVolumeChange)
      video.removeEventListener("timeupdate", onTimeUpdate)
      audio.removeEventListener("error", onAudioError)
      audio.removeEventListener("pause", onAudioPause)
      audio.removeEventListener("waiting", onAudioWaiting)
      audio.removeEventListener("playing", clearAudioBuffering)
      audio.removeEventListener("canplay", clearAudioBuffering)
      audio.removeEventListener("error", clearAudioBuffering)
      clearAudioBuffering()
      audio.removeEventListener("loadedmetadata", syncOnReady)
      audio.removeEventListener("canplay", syncOnReady)
      // Kaynak BURADA boşaltılmaz: React yeni `src`'yi DOM'a zaten yazdı,
      // removeAttribute yeni ses parçasının adresini silip videoyu sessiz
      // bırakıyordu. Boşaltma yalnızca bileşen kalkarken yapılır.
      audio.pause()
    }
  }, [audioSrc, setAudioBuffering])

  /** Bileşen kalkarken ses elementini boşalt: eski akış arka planda çalmasın. */
  useEffect(() => {
    const audio = audioRef.current
    return () => {
      if (!audio) return
      audio.pause()
      audio.removeAttribute("src")
      audio.load()
    }
  }, [])

  /** Ayrı ses akışı yokken ses elementi tamamen susturulur: çift ses olamaz. */
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || audioSrc) return
    audio.pause()
    audio.removeAttribute("src")
    audio.load()
  }, [audioSrc])

  /** Yeni ses parçası hazır olunca "Ses yükleniyor" göstergesini kapat.
   *
   * Dublaj akışları imzalı CDN adreslerinden geldiği için ilk baytlar birkaç
   * saniye gecikebilir; gösterge bu süreyi kullanıcıya bildirir. */
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const done = () => setAudioSwitching(false)
    audio.addEventListener("canplay", done)
    audio.addEventListener("playing", done)
    audio.addEventListener("error", done)
    // Çok hızlı (önbellekten) hazır olan akışta olay dinleyiciler bağlanmadan
    // önce tetiklenmiş olabilir; durumu bir kez de doğrudan kontrol et.
    if (audio.readyState >= 3) done()
    // Olay gelmezse gösterge takılı kalmasın.
    const timer = window.setTimeout(done, 15000)
    return () => {
      window.clearTimeout(timer)
      audio.removeEventListener("canplay", done)
      audio.removeEventListener("playing", done)
      audio.removeEventListener("error", done)
    }
  }, [audioSrc, setAudioSwitching])

  const { toggle: toggleFullscreen } = useFullscreen()

  useEffect(() => {
    const el = videoRef.current
    if (!el) return

    const player = usePlayerStore.getState()
    const { mark, noteStatus } = player
    let rafId = 0
    let seekNoteTimer = 0

    const clearSeekNote = () => {
      if (seekNoteTimer) {
        window.clearTimeout(seekNoteTimer)
        seekNoteTimer = 0
      }
    }

    const tick = () => {
      const video = videoRef.current
      if (!video || video.paused) return
      const { segments, trim, loop } = useEditStore.getState()
      // Kesilen aralıklar oynatılırken atlanır: duyulan = dışa aktarılan.
      if (segments.length > 0) {
        const gap = gapsOf(segments, trim).find(
          (item) => video.currentTime >= item.start && video.currentTime < item.end,
        )
        if (gap) {
          video.currentTime = gap.end
          mark({ currentTime: gap.end })
          rafId = requestAnimationFrame(tick)
          return
        }
      }
      mark({ currentTime: video.currentTime })

      // Döngü: çıkış noktasına gelince başa sar
      if (loop && trim.end > trim.start + 0.05 && video.currentTime >= trim.end) {
        video.currentTime = trim.start
      }
      rafId = requestAnimationFrame(tick)
    }

    const startTicking = () => {
      if (!rafId) rafId = requestAnimationFrame(tick)
    }
    const stopTicking = () => {
      if (rafId) {
        cancelAnimationFrame(rafId)
        rafId = 0
      }
    }

    const readBufferedEnd = () => {
      const buffered = el.buffered
      return buffered.length ? buffered.end(buffered.length - 1) : 0
    }

    /** Kaynak yüklemesi (load) playbackRate'i sıfırlayabildiği için tercih yeniden uygulanır. */
    const applyPlaybackRate = () => {
      const desired = usePlayerStore.getState().playbackRate
      if (el.playbackRate !== desired) {
        el.defaultPlaybackRate = desired
        el.playbackRate = desired
      }
    }

    /** Kaynak başına bir kez kare hızı ölçülür (kare adımı için). */
    let measuredForSource = false

    /** Oynatılan görüntünün gerçek kare hızını kareden kareye zaman farkından ölçer.
     *  Çok varyantlı HLS'te ffprobe ilk (en yüksek) varyantı görebildiği için
     *  asıl oynatılan varyantın hızı burada ölçülür. */
    const measureFrameRate = () => {
      if (measuredForSource || typeof el.requestVideoFrameCallback !== "function") return
      measuredForSource = true

      const mediaTimes: number[] = []
      const onFrame = (_now: number, metadata: { mediaTime?: number }) => {
        const mediaTime = metadata?.mediaTime
        if (typeof mediaTime !== "number") {
          measuredForSource = false
          return
        }
        mediaTimes.push(mediaTime)
        if (mediaTimes.length < 7) {
          el.requestVideoFrameCallback(onFrame)
          return
        }

        const deltas = mediaTimes
          .slice(1)
          .map((time, index) => time - mediaTimes[index])
          .filter((delta) => delta > 0.001)
        if (deltas.length < 3) {
          measuredForSource = false
          return
        }
        deltas.sort((a, b) => a - b)
        const median = deltas[Math.floor(deltas.length / 2)]
        const fps = median > 0 ? Math.round((1 / median) * 100) / 100 : 0
        if (fps < 5 || fps > 240) {
          measuredForSource = false
          return
        }

        const known = useSourceStore.getState().meta?.fps
        if (!known || Math.abs(known - fps) > 0.01) {
          setMeta({ fps })
          log("info", translate("log.frameRateMeasured", { fps }))
        }
      }

      el.requestVideoFrameCallback(onFrame)
    }

    const onLoadedMetadata = () => {
      // Canlı HLS'te tarayıcı yalnızca kayar pencere süresini bildirir; bunu
      // toplam süre sanıp zaman çizelgesine/rozetlere yazma.
      const source = useSourceStore.getState()
      // Canlı önizlemede sahne yayını gösterir: süre bilinmez (kayan pencere).
      const live = source.isLive || source.previewLive
      // Proje akışı büyüyen bir EVENT playlist'idir: tarayıcı süreyi
      // `Infinity`/o ana kadarki uç olarak bildirebilir. Süre her zaman
      // backend özetinden (segment toplamı) gelir.
      const streamDuration =
        source.streamId && !source.previewLive ? (source.meta?.duration ?? 0) : 0
      const duration = live
        ? 0
        : streamDuration > 0
          ? streamDuration
          : Number.isFinite(el.duration)
            ? el.duration
            : 0
      clearSeekNote()
      applyPlaybackRate()
      measuredForSource = false
      mark({
        duration,
        buffering: false,
        statusNote: null,
        videoWidth: el.videoWidth,
        videoHeight: el.videoHeight,
      })
      if (el.videoWidth > 0) {
        const key = `${el.videoWidth}x${el.videoHeight}@${Math.round(duration)}`
        if (metaLoggedRef.current !== key) {
          metaLoggedRef.current = key
          log(
            "success",
            translate("log.metadataLoaded", {
              width: el.videoWidth,
              height: el.videoHeight,
              duration: formatTime(duration),
            }),
          )
        }
      }
      if (!useSourceStore.getState().meta && el.videoWidth > 0) {
        setMeta({
          width: el.videoWidth,
          height: el.videoHeight,
          duration,
          // Ayrı bir ses akışı varsa video elementinin sesi yoktur.
          hasAudio: !useSourceStore.getState().audioUrl,
        })
      }

      // Kalite değiştirildiğinde kaldığı konumdan ve aynı oynatma durumunda devam et.
      const pending = pendingSwitchRef.current
      if (pending) {
        pendingSwitchRef.current = null
        const limit = duration > 0 ? Math.max(0, duration - 0.25) : pending.time
        const target = Math.min(Math.max(pending.time, 0), limit)
        if (target > 0.05) el.currentTime = target
        if (pending.playing) void el.play().catch(() => undefined)
      }

      // Proje geri yüklemesinde kaydedilen oynatma konumu, meta veri hazır
      // olduğunda bir kez uygulanır. Kalite değişimi daha yeni bir hedef
      // belirlediyse onu ezme.
      const pendingSeek = usePlayerStore.getState().pendingSeek
      if (pendingSeek !== null) {
        if (!pending) {
          const limit = duration > 0 ? Math.max(0, duration - 0.05) : pendingSeek
          const target = Math.min(Math.max(pendingSeek, 0), limit)
          if (target > 0.05) el.currentTime = target
        }
        usePlayerStore.getState().clearPendingSeek()
      }

      // Yıkıcı değişimde (blok silme) oynatma adresi değişir ve oynatıcı
      // yeniden bağlanır: kullanıcı izlemeye devam ediyorsa oynatma sürer.
      if (usePlayerStore.getState().pendingPlay) {
        usePlayerStore.getState().clearPendingPlay()
        if (!pending?.playing) void el.play().catch(() => undefined)
      }
    }
    let endTimer = 0
    const clearEndWatch = () => {
      if (endTimer) {
        window.clearTimeout(endTimer)
        endTimer = 0
      }
    }
    /** Proje akışı büyüyen bir EVENT listesidir: son kare bittiğinde tarayıcı
     *  `ended` olayını tetiklemez (süre, son karenin birkaç ms ötesinde biter).
     *  Kayıt sürmüyorsa ve uçtaysak oynatma bitmiş sayılır. Kayıt sürerken
     *  yeni segment birkaç saniyede gelir; o zaman dokunulmaz. */
    const streamStillRecording = () => {
      const streamId = useSourceStore.getState().streamId
      if (!streamId) return false
      return useRecorderStore
        .getState()
        .recordings.some((item) => item.stream_id === streamId)
    }
    const atStreamEnd = () => {
      if (!Number.isFinite(el.duration) || el.duration <= 0) return false
      if (el.currentTime < el.duration - 0.5) return false
      return readBufferedEnd() >= el.duration - 0.5
    }
    const watchStreamEnd = () => {
      const source = useSourceStore.getState()
      const streaming = Boolean(source.streamId) && !source.previewLive
      if (!streaming || streamStillRecording() || !atStreamEnd()) {
        clearEndWatch()
        return
      }
      if (endTimer) return
      endTimer = window.setTimeout(() => {
        endTimer = 0
        if (el.paused || streamStillRecording() || !atStreamEnd()) return
        // Duraklatma `pause` olayını tetikler; ayrı ses akışı da aynı yolu izler.
        el.pause()
        mark({
          playing: false,
          buffering: false,
          currentTime: el.duration || el.currentTime,
        })
        stopTicking()
      }, END_STALL_MS)
    }
    const onTimeUpdate = () => {
      mark({ currentTime: el.currentTime })
      watchStreamEnd()
    }
    const onPlay = () => {
      clearEndWatch()
      mark({ playing: true, buffering: false })
      startTicking()
      measureFrameRate()
    }
    const onPause = () => {
      clearEndWatch()
      mark({ playing: false, currentTime: el.currentTime })
      stopTicking()
    }
    const onEnded = () => {
      clearEndWatch()
      mark({ playing: false, currentTime: el.duration || 0 })
      stopTicking()
    }

    const onProgress = () => mark({ bufferedEnd: readBufferedEnd() })
    const onWaiting = () => {
      mark({ buffering: true })
      watchStreamEnd()
      if (!bufferingLoggedRef.current) {
        bufferingLoggedRef.current = true
        log("info", translate("log.buffering"))
      }
    }
    const onCanPlay = () => {
      mark({ buffering: false })
      bufferingLoggedRef.current = false
      applyPlaybackRate()
    }
    const onStalled = () => {
      mark({ buffering: true })
      watchStreamEnd()
      if (!bufferingLoggedRef.current) {
        bufferingLoggedRef.current = true
        log("warn", translate("log.stalled"))
      }
    }
    const onSeeking = () => {
      clearSeekNote()
      noteStatus({ label: translate("status.frameLoading"), tone: "buffering" })
    }
    const onSeeked = () => {
      mark({ currentTime: el.currentTime })
      noteStatus({ label: translate("status.frameLoaded"), tone: "ready" })
      clearSeekNote()
      seekNoteTimer = window.setTimeout(() => {
        seekNoteTimer = 0
        usePlayerStore.getState().noteStatus(null)
      }, SEEK_NOTE_MS)
    }
    const onVideoResize = () =>
      mark({ videoWidth: el.videoWidth, videoHeight: el.videoHeight })
    const onVolumeChange = () => mark({ volume: el.volume, muted: el.muted })
    const onRateChange = () => mark({ playbackRate: el.playbackRate })
    const onEnterPip = () => mark({ pipActive: true })
    const onLeavePip = () => mark({ pipActive: false })
    const onError = () => {
      if (!el.error) return
      const detail = el.error.message || translate("video.errorCode", { code: el.error.code })
      log("error", translate("log.videoError"), detail)
      noteStatus({ label: translate("status.error"), tone: "error" })
      toast.error(translate("video.cannotPlay"), { description: detail })
    }

    player.bind(el)
    el.addEventListener("loadedmetadata", onLoadedMetadata)
    el.addEventListener("timeupdate", onTimeUpdate)
    el.addEventListener("play", onPlay)
    el.addEventListener("pause", onPause)
    el.addEventListener("ended", onEnded)
    el.addEventListener("progress", onProgress)
    el.addEventListener("waiting", onWaiting)
    el.addEventListener("canplay", onCanPlay)
    el.addEventListener("stalled", onStalled)
    el.addEventListener("seeking", onSeeking)
    el.addEventListener("seeked", onSeeked)
    el.addEventListener("resize", onVideoResize)
    el.addEventListener("volumechange", onVolumeChange)
    el.addEventListener("ratechange", onRateChange)
    el.addEventListener("enterpictureinpicture", onEnterPip)
    el.addEventListener("leavepictureinpicture", onLeavePip)
    el.addEventListener("error", onError)

    if (el.readyState >= 1) onLoadedMetadata()
    if (!el.paused) startTicking()

    return () => {
      stopTicking()
      clearSeekNote()
      clearEndWatch()
      el.removeEventListener("loadedmetadata", onLoadedMetadata)
      el.removeEventListener("timeupdate", onTimeUpdate)
      el.removeEventListener("play", onPlay)
      el.removeEventListener("pause", onPause)
      el.removeEventListener("ended", onEnded)
      el.removeEventListener("progress", onProgress)
      el.removeEventListener("waiting", onWaiting)
      el.removeEventListener("canplay", onCanPlay)
      el.removeEventListener("stalled", onStalled)
      el.removeEventListener("seeking", onSeeking)
      el.removeEventListener("seeked", onSeeked)
      el.removeEventListener("resize", onVideoResize)
      el.removeEventListener("volumechange", onVolumeChange)
      el.removeEventListener("ratechange", onRateChange)
      el.removeEventListener("enterpictureinpicture", onEnterPip)
      el.removeEventListener("leavepictureinpicture", onLeavePip)
      el.removeEventListener("error", onError)
      usePlayerStore.getState().bind(null)
    }
  }, [setMeta])

  return (
    <div
      data-slot="video-stage"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10"
    >
      <div
        className="stage-frame relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black"
        onDoubleClick={toggleFullscreen}
        title={t("video.doubleClickFullscreen")}
      >
        <video
          ref={videoRef}
          className="stage-video max-h-full w-full object-contain"
          playsInline
        >
          {subtitleSrc && previewSubtitleTrack && (
            <track
              key={subtitleSrc}
              id="clipstream-subtitle"
              kind="subtitles"
              src={subtitleSrc}
              srcLang={previewSubtitleTrack.language || "und"}
              label={previewSubtitleTrack.name}
              default
            />
          )}
        </video>

        {/* Video akışı sessizse (YouTube HLS): ses ayrı kanaldan eşlenir. */}
        <audio
          ref={audioRef}
          src={audioSrc && !audioIsHls ? audioSrc : undefined}
          preload="auto"
          data-slot="audio-track"
        />

        <div className="absolute inset-x-3 top-3 z-20 flex items-center gap-2">
          <CropMenu />
          <div className="ml-auto flex items-center gap-2">
            {(audioSwitching || audioBuffering) && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white backdrop-blur"
                role="status"
                aria-live="polite"
              >
                <Loader2 className="size-3 animate-spin" />
                {audioSwitching
                  ? t("source.audioLoading")
                  : t("source.audioBuffering")}
              </span>
            )}
            <StreamStatusBadge />
          </div>
        </div>

        {streamUrl && cropEnabled && <CropOverlay videoRef={videoRef} />}
        {streamUrl && <StageControls />}
        {!streamUrl && <EmptyStage />}
      </div>
    </div>
  )
}

function EmptyStage() {
  const { t } = useI18n()
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
      <Clapperboard className="size-8" />
      <p className="text-sm font-medium text-foreground">{t("video.emptyTitle")}</p>
      <p className="max-w-sm text-xs">{t("video.emptyDescription")}</p>
    </div>
  )
}
