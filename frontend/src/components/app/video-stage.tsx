/** Sahne: video elementi + olay bağlama + overlay'ler. */
import { useEffect, useRef } from "react"

import { Clapperboard } from "lucide-react"
import type HlsJs from "hls.js"
import { toast } from "sonner"

import { CropOverlay } from "@/components/app/crop-overlay"
import { CropToolbar } from "@/components/app/crop-toolbar"
import { PlayerControls } from "@/components/app/player-controls"
import { SeekBar } from "@/components/app/seek-bar"
import { StreamStatusBadge } from "@/components/app/stream-status-badge"
import { Timeline } from "@/components/app/timeline"
import { TrimBar } from "@/components/app/trim-bar"
import { useHlsSource } from "@/hooks/use-hls-source"
import { useFullscreen } from "@/hooks/use-fullscreen"
import { formatTime } from "@/lib/format"
import { isHlsUrl, proxiedUrl } from "@/lib/media"
import { cn } from "cn"
import { log } from "@/stores/log-store"
import { usePlayerStore } from "@/stores/player-store"
import { useStudioStore } from "@/stores/studio-store"

/** "Kare Yüklendi" bildiriminin ekranda kalma süresi (ms). */
const SEEK_NOTE_MS = 1200

export function VideoStage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  /** Aynı meta veriyi tekrar tekrar loglamamak için son kaydedilen boyut/süre. */
  const metaLoggedRef = useRef<string | null>(null)
  /** Arabelleğe alma kaydının spam olmaması için bayrak. */
  const bufferingLoggedRef = useRef(false)
  const streamUrl = useStudioStore((s) => s.streamUrl)
  const useProxy = useStudioStore((s) => s.useProxy)
  const platform = useStudioStore((s) => s.platform)
  const audioUrl = useStudioStore((s) => s.audioUrl)
  const variants = useStudioStore((s) => s.variants)
  const headerToken = useStudioStore((s) => s.headerToken)
  const previewHeight = useStudioStore((s) => s.previewHeight)
  const cropEnabled = useStudioStore((s) => s.crop.enabled)
  const setMeta = useStudioStore((s) => s.setMeta)

  // Önizleme kalitesi: seçili varyant (seçim yoksa kaynağın en yükseği).
  // Dışa aktarma, dalga formu ve analiz her zaman kaynağın en yüksek kalitesini
  // (streamUrl/audioUrl) kullanır; burada yalnızca oynatma kaynağı değişir.
  const previewVariant =
    variants.find((item) => item.height === previewHeight) ?? variants[0] ?? null
  const previewStreamUrl = previewVariant?.url ?? streamUrl
  const previewAudioUrl = previewVariant ? previewVariant.audio_url ?? null : audioUrl

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
  /** Ses akışı HLS (ör. X ses rendition'ı) ise `src` yerine hls.js ile bağlanır. */
  const audioIsHls = Boolean(audioSrc && isHlsUrl(audioSrc))
  useHlsSource(videoRef, playerSrc)

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
    if (!audio || !audioSrc || !isHlsUrl(audioSrc)) return

    let hls: HlsJs | null = null
    let disposed = false

    const setup = async () => {
      const { default: Hls } = await import("hls.js")
      if (disposed || !Hls.isSupported()) return
      log("info", "Ses akışı HLS: hls.js ses elementine bağlanıyor...")
      hls = new Hls({ enableWorker: true })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || !hls) return
        log("error", "Ses akışı (HLS) hatası.", String(data.details))
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
      log("warn", "Ses akışı koptu; yeniden yükleniyor ve görüntü konumuna hizalanıyor.")
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
            "Video akışı kendi sesini içeriyor: ayrı ses akışı durduruldu (çift ses engellendi).",
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
        log("warn", "Ses akışı yanıt vermiyor; yeniden yükleniyor.")
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
      const { trim, loop } = useStudioStore.getState()
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

        const known = useStudioStore.getState().meta?.fps
        if (!known || Math.abs(known - fps) > 0.01) {
          setMeta({ fps })
          log("info", `Kare hızı ölçüldü: ${fps} fps (hassas kare adımı için kullanılır).`)
        }
      }

      el.requestVideoFrameCallback(onFrame)
    }

    const onLoadedMetadata = () => {
      const duration = Number.isFinite(el.duration) ? el.duration : 0
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
            `Video meta verileri yüklendi (${el.videoWidth}×${el.videoHeight}, ${formatTime(duration)})`,
          )
        }
      }
      if (!useStudioStore.getState().meta && el.videoWidth > 0) {
        setMeta({
          width: el.videoWidth,
          height: el.videoHeight,
          duration,
          // Ayrı bir ses akışı varsa video elementinin sesi yoktur.
          hasAudio: !useStudioStore.getState().audioUrl,
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
        log("info", "Video arabelleğe alınıyor (buffering)...")
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
        log("warn", "Yayın akışı durakladı (stalled).")
      }
    }
    const onSeeking = () => {
      clearSeekNote()
      noteStatus({ label: "Kare Yükleniyor...", tone: "buffering" })
    }
    const onSeeked = () => {
      mark({ currentTime: el.currentTime })
      noteStatus({ label: "Kare Yüklendi", tone: "ready" })
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
      const detail = el.error.message || `hata kodu ${el.error.code}`
      log("error", "Video oynatılamadı", detail)
      noteStatus({ label: "Hata Oluştu", tone: "error" })
      toast.error("Video oynatılamadı", { description: detail })
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
        title="Çift tıkla: tam ekran"
      >
        <video
          ref={videoRef}
          className="stage-video max-h-[58vh] w-full object-contain"
          playsInline
        />

        {/* Video akışı sessizse (YouTube HLS): ses ayrı kanaldan eşlenir. */}
        <audio
          ref={audioRef}
          src={audioSrc && !audioIsHls ? audioSrc : undefined}
          preload="auto"
          data-slot="audio-track"
        />

        <div className="absolute inset-x-2 top-2 z-20 flex items-center">
          <StreamStatusBadge className="ml-auto" />
        </div>

        {streamUrl && cropEnabled && <CropOverlay videoRef={videoRef} />}
        {!streamUrl && <EmptyStage />}
      </div>

      <div
        inert={!streamUrl}
        className={cn(
          "stage-strip space-y-3 px-3 pb-3 pt-0",
          !streamUrl && "pointer-events-none opacity-60",
        )}
      >
        <SeekBar />
        <CropToolbar />
        <PlayerControls />
        <Timeline />
        <TrimBar />
      </div>
    </div>
  )
}

function EmptyStage() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
      <Clapperboard className="size-8" />
      <p className="text-sm font-medium text-foreground">Kaynak bekleniyor</p>
      <p className="max-w-sm text-xs">
        Sağdaki kaynak panelinden bir bağlantı yükle, bilgisayarından video seç ya da
        videoyu doğrudan bu pencereye sürükle-bırak.
      </p>
    </div>
  )
}
