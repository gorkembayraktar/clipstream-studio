/** Sahne: video elementi + olay bağlama + overlay'ler. */
import { useEffect, useRef } from "react"

import { Clapperboard } from "lucide-react"
import type HlsJs from "hls.js"
import { toast } from "sonner"

import { CropMenu } from "@/components/app/crop-menu"
import { CropOverlay } from "@/components/app/crop-overlay"
import { StageControls } from "@/components/app/stage-controls"
import { StreamStatusBadge } from "@/components/app/stream-status-badge"
import { Timeline } from "@/components/app/timeline"
import { TimelineToolbar } from "@/components/app/timeline-toolbar"
import { TrimBar } from "@/components/app/trim-bar"
import { useHlsSource } from "@/hooks/use-hls-source"
import { useSubtitleVtt } from "@/hooks/use-subtitles"
import { useFullscreen } from "@/hooks/use-fullscreen"
import { translate, useI18n } from "@/i18n"
import { formatTime } from "@/lib/format"
import { isHlsUrl, proxiedUrl } from "@/lib/media"
import { cn } from "cn"
import { useEditStore } from "@/stores/edit-store"
import { log } from "@/stores/log-store"
import { usePlayerStore } from "@/stores/player-store"
import { useSourceStore } from "@/stores/source-store"

/** "Kare Yüklendi" bildiriminin ekranda kalma süresi (ms). */
const SEEK_NOTE_MS = 1200

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
  const subtitleTracks = useSourceStore((s) => s.subtitleTracks)
  const subtitleTrackId = useSourceStore((s) => s.subtitleTrackId)
  const headers = useSourceStore((s) => s.headers)
  const variants = useSourceStore((s) => s.variants)
  const sourceIsHls = useSourceStore((s) => s.isHls)
  const headerToken = useSourceStore((s) => s.headerToken)
  const previewHeight = useSourceStore((s) => s.previewHeight)
  const cropEnabled = useEditStore((s) => s.crop.enabled)
  const setMeta = useSourceStore((s) => s.setMeta)

  // Önizleme kalitesi: seçili varyant (seçim yoksa kaynağın en yükseği).
  // Dışa aktarma, dalga formu ve analiz her zaman kaynağın en yüksek kalitesini
  // (streamUrl/audioUrl) kullanır; burada yalnızca oynatma kaynağı değişir.
  const previewVariant =
    variants.find((item) => (item.quality_height ?? item.height) === previewHeight) ??
    variants[0] ??
    null
  const previewStreamUrl = previewVariant?.url ?? streamUrl
  // Kalite değişse de seçili ses rendition'ı kararlı kimlikle eşlenir; o
  // varyantta yoksa varyantın varsayılan sesine düşülür.
  const previewAudioTrack =
    previewVariant?.audio_tracks?.find((track) => track.id === audioTrackId) ??
    previewVariant?.audio_tracks?.find((track) => track.default) ??
    null
  const previewAudioUrl = previewVariant
    ? (previewAudioTrack?.url ?? previewVariant.audio_url ?? null)
    : audioUrl
  /** Seçili varyantın HLS bilgisi; varyant yoksa kaynak seviyesindeki tespit. */
  const playerIsHls = previewVariant?.hls ?? sourceIsHls

  // YouTube/X/Instagram akışları tarayıcıdan doğrudan çalınamaz (CORS) → proxy otomatik.
  // Yerel dosyalar (/uploads/...) aynı sunucudan geldiği için proxy gerekmez.
  // curl ile başlık verildiyse tarayıcı bunları gönderemez → proxy zorunlu.
  const needsProxy =
    useProxy || (platform !== "direct" && platform !== "local") || Boolean(headerToken)
  const playerSrc = previewStreamUrl
    ? needsProxy
      ? proxiedUrl(previewStreamUrl, headerToken)
      : previewStreamUrl
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
  useHlsSource(videoRef, playerSrc, playerIsHls)

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
   * Altın kural: **ses asla geri sarılmaz.** Video donduğunda sesi geri sarmak
   * aynı bölümün tekrar tekrar duyulmasına ("çift ses") yol açar; bunun yerine
   * geride kalan taraf ileri alınır ve sekme gizliyken görüntü oynatılmaya çalışılır. */
  useEffect(() => {
    const video = videoRef.current
    const audio = audioRef.current
    if (!video || !audio || !audioSrc) return

    // Kısa bir "oturma" penceresi: kendi tetiklediğimiz düzeltmeyi tekrar düzeltmeyelim.
    let settleUntil = 0
    const settle = () => {
      settleUntil = performance.now() + 700
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
      settle()
      seekTo(video, audio.currentTime)
    }
    const resumeAudio = () => {
      if (video.muted) return
      void audio.play().catch(() => undefined)
    }

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

    const onPlay = () => {
      wantsPlayRef.current = true
      audio.playbackRate = video.playbackRate
      audio.volume = video.volume
      audio.muted = video.muted
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
    const onSeeking = () => audio.pause()
    const onSeeked = () => {
      if (Math.abs(audio.currentTime - video.currentTime) > 0.05) {
        seekTo(audio, video.currentTime)
      }
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
    const watchdog = window.setInterval(() => {
      if (!wantsPlayRef.current || video.ended) return

      // Emniyet kemeri: video elementinin kendi ses akışı varsa (has_audio yanlış
      // bilinmişse) ayrı ses elementi kapatılır; iki kaynak birlikte çalınamaz.
      const decodedAudio = (video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number })
        .webkitAudioDecodedByteCount
      if (typeof decodedAudio === "number" && decodedAudio > 0 && !audio.paused) {
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
      if (audio.currentTime - video.currentTime > 0.35) seekTo(video, audio.currentTime)
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
      audio.pause()
      // Kaynak boşaltılmazsa tarayıcı eski akışı arka planda çalmayı sürdürebilir
      // (attrsuz kalan medya elementi load() çağrılana kadar çalmaya devam eder).
      audio.removeAttribute("src")
      audio.load()
    }
  }, [audioSrc])

  /** Ayrı ses akışı yokken ses elementi tamamen susturulur: çift ses olamaz. */
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || audioSrc) return
    audio.pause()
    audio.removeAttribute("src")
    audio.load()
  }, [audioSrc])

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
      mark({ currentTime: video.currentTime })

      // Döngü: çıkış noktasına gelince başa sar
      const { trim, loop } = useEditStore.getState()
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
      const live = useSourceStore.getState().isLive
      const duration = live ? 0 : Number.isFinite(el.duration) ? el.duration : 0
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
    }
    const onTimeUpdate = () => mark({ currentTime: el.currentTime })
    const onPlay = () => {
      mark({ playing: true, buffering: false })
      startTicking()
      measureFrameRate()
    }
    const onPause = () => {
      mark({ playing: false, currentTime: el.currentTime })
      stopTicking()
    }
    const onEnded = () => {
      mark({ playing: false, currentTime: el.duration || 0 })
      stopTicking()
    }
    const onProgress = () => mark({ bufferedEnd: readBufferedEnd() })
    const onWaiting = () => {
      mark({ buffering: true })
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
      className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10"
    >
      <div
        className="stage-frame relative flex min-h-60 items-center justify-center bg-black"
        onDoubleClick={toggleFullscreen}
        title={t("video.doubleClickFullscreen")}
      >
        <video
          ref={videoRef}
          className="stage-video max-h-[58vh] w-full object-contain"
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
          <StreamStatusBadge className="ml-auto" />
        </div>

        {streamUrl && cropEnabled && <CropOverlay videoRef={videoRef} />}
        {streamUrl && <StageControls />}
        {!streamUrl && <EmptyStage />}
      </div>

      <div
        inert={!streamUrl}
        className={cn(
          "stage-strip space-y-2 px-3 py-3",
          !streamUrl && "pointer-events-none opacity-60",
        )}
      >
        <TimelineToolbar />
        <Timeline />
        <TrimBar />
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
