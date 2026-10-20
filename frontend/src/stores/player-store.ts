/** Oynatıcı durumu: video elementiyle senkron çalışan ince bir zustand katmanı. */
import { create } from "zustand"

import { translate } from "@/i18n"
import { clamp } from "@/lib/format"
import { log } from "@/stores/log-store"
import { useStudioStore } from "@/stores/studio-store"

export type StatusTone = "idle" | "buffering" | "ready" | "error"

/** Kısa ömürlü durum bildirimi (ör. "Kare Yükleniyor..." / "Kare Yüklendi"). */
export interface StatusNote {
  label: string
  tone: StatusTone
}

/** Oynatma hızı sınırları (tarayıcılar 0.0625–16 arasını destekler). */
export const MIN_PLAYBACK_RATE = 0.25
export const MAX_PLAYBACK_RATE = 4

/** Ses açma/kısma adımı (±%5). */
export const VOLUME_STEP = 0.05

/** Hassas adım modları: "1 kare" ya da sabit milisaniye değerleri. */
export const STEP_MODES = ["frame", "ms10", "ms50", "ms100", "ms250", "ms500"] as const
export type StepMode = (typeof STEP_MODES)[number]

/** Mod başına milisaniye karşılığı (kare modu fps'e göre hesaplanır). */
const STEP_MS: Record<Exclude<StepMode, "frame">, number> = {
  ms10: 10,
  ms50: 50,
  ms100: 100,
  ms250: 250,
  ms500: 500,
}

/** Kare hızı bilinmiyorsa kare adımı için kullanılan varsayılan. */
export const FALLBACK_FPS = 30

/** Adım modu geçerli mi (saklanan tercih bozulmuşsa varsayılana döner). */
function toStepMode(value: unknown): StepMode {
  return typeof value === "string" && (STEP_MODES as readonly string[]).includes(value)
    ? (value as StepMode)
    : "frame"
}

interface PlayerState {
  playing: boolean
  buffering: boolean
  statusNote: StatusNote | null
  currentTime: number
  duration: number
  bufferedEnd: number
  volume: number
  muted: boolean
  playbackRate: number
  pipActive: boolean
  pipSupported: boolean
  videoWidth: number
  videoHeight: number
  /** Hassas adım büyüklüğü (kare ya da ms). */
  stepMode: StepMode

  bind: (el: HTMLVideoElement | null) => void
  mark: (
    partial: Partial<
      Pick<
        PlayerState,
        | "playing"
        | "buffering"
        | "statusNote"
        | "currentTime"
        | "duration"
        | "bufferedEnd"
        | "volume"
        | "muted"
        | "playbackRate"
        | "pipActive"
        | "pipSupported"
        | "videoWidth"
        | "videoHeight"
      >
    >,
  ) => void
  noteStatus: (note: StatusNote | null) => void
  play: () => void
  pause: () => void
  toggle: () => void
  seek: (time: number) => void
  seekBy: (delta: number) => void
  setVolume: (value: number) => void
  nudgeVolume: (delta: number) => void
  toggleMute: () => void
  setPlaybackRate: (rate: number) => void
  togglePip: () => void
  setStepMode: (mode: StepMode) => void
  /** Hassas adım: count adet adım ileri (+) / geri (−) sarar. */
  step: (count: number) => void
}

/** Video elementi store dışında tutulur: React yeniden render'ına gerek yok. */
let videoEl: HTMLVideoElement | null = null

export function getVideoElement(): HTMLVideoElement | null {
  return videoEl
}

/** Ses/hız tercihleri tarayıcıda saklanır ve her yeni kaynakta yeniden uygulanır. */
const PREFS_KEY = "clip2:player-prefs"

interface PlayerPrefs {
  volume: number
  muted: boolean
  playbackRate: number
  stepMode: StepMode
}

const DEFAULT_PREFS: PlayerPrefs = { volume: 1, muted: false, playbackRate: 1, stepMode: "frame" }

function readPrefs(): PlayerPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<PlayerPrefs>
    return {
      volume: typeof parsed.volume === "number" ? clamp(parsed.volume, 0, 1) : DEFAULT_PREFS.volume,
      muted: typeof parsed.muted === "boolean" ? parsed.muted : DEFAULT_PREFS.muted,
      playbackRate:
        typeof parsed.playbackRate === "number"
          ? clamp(parsed.playbackRate, MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE)
          : DEFAULT_PREFS.playbackRate,
      stepMode: toStepMode(parsed.stepMode),
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function persistPrefs(
  state: Pick<PlayerState, "volume" | "muted" | "playbackRate" | "stepMode">,
) {
  try {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        volume: state.volume,
        muted: state.muted,
        playbackRate: state.playbackRate,
        stepMode: state.stepMode,
      }),
    )
  } catch {
    /* gizli sekme vb. durumlarda sessizce yok sayılır */
  }
}

const initialPrefs = readPrefs()

export const usePlayerStore = create<PlayerState>()((set, get) => ({
  playing: false,
  buffering: false,
  statusNote: null,
  currentTime: 0,
  duration: 0,
  bufferedEnd: 0,
  volume: initialPrefs.volume,
  muted: initialPrefs.muted,
  playbackRate: initialPrefs.playbackRate,
  pipActive: false,
  pipSupported: false,
  videoWidth: 0,
  videoHeight: 0,
  stepMode: initialPrefs.stepMode,

  bind: (el) => {
    videoEl = el
    if (!el) {
      set({
        playing: false,
        buffering: false,
        statusNote: null,
        currentTime: 0,
        duration: 0,
        bufferedEnd: 0,
        pipActive: false,
        videoWidth: 0,
        videoHeight: 0,
      })
      return
    }

    // Kaydedilmiş tercihler yeni video elementine uygulanır
    const { volume, muted, playbackRate } = get()
    el.volume = volume
    el.muted = muted
    el.defaultPlaybackRate = playbackRate
    el.playbackRate = playbackRate

    set({
      playing: !el.paused,
      buffering: false,
      statusNote: null,
      currentTime: el.currentTime,
      duration: Number.isFinite(el.duration) ? el.duration : 0,
      volume: el.volume,
      muted: el.muted,
      playbackRate: el.playbackRate,
      pipActive: Boolean(document.pictureInPictureElement),
      pipSupported: Boolean(document.pictureInPictureEnabled),
      videoWidth: el.videoWidth,
      videoHeight: el.videoHeight,
    })
  },

  mark: (partial) => set(partial),
  noteStatus: (note) => set({ statusNote: note }),

  play: () => {
    void videoEl?.play()
  },

  pause: () => {
    videoEl?.pause()
  },

  toggle: () => {
    if (!videoEl) return
    if (videoEl.paused) void videoEl.play()
    else videoEl.pause()
  },

  seek: (time) => {
    if (!videoEl) return
    const target = clamp(time, 0, videoEl.duration || 0)
    videoEl.currentTime = target
    set({ currentTime: target })
  },

  seekBy: (delta) => {
    const current = videoEl?.currentTime ?? get().currentTime
    get().seek(current + delta)
  },

  setVolume: (value) => {
    const next = clamp(value, 0, 1)
    if (videoEl) {
      videoEl.volume = next
      if (next > 0 && videoEl.muted) videoEl.muted = false
    }
    set({ volume: next, muted: videoEl ? videoEl.muted : false })
    persistPrefs(get())
  },

  /** Klavye/düğme ile kademeli ses ayarı (±0.05). */
  nudgeVolume: (delta) => {
    const current = videoEl ? videoEl.volume : get().volume
    get().setVolume(current + delta)
  },

  toggleMute: () => {
    if (videoEl) videoEl.muted = !videoEl.muted
    else set({ muted: !get().muted })
    if (videoEl) set({ muted: videoEl.muted })
    persistPrefs(get())
  },

  setPlaybackRate: (rate) => {
    const next = clamp(rate, MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE)
    if (videoEl) {
      // defaultPlaybackRate: kaynak yüklemesi (load) hızı sıfırlamasın
      videoEl.defaultPlaybackRate = next
      videoEl.playbackRate = next
    }
    set({ playbackRate: next })
    persistPrefs(get())
    log("info", translate("log.rateSet", { rate: next }))
  },

  togglePip: () => {
    const el = videoEl
    if (!el || !document.pictureInPictureEnabled) {
      log("warn", translate("log.pipUnsupported"))
      return
    }
    if (document.pictureInPictureElement) {
      void document.exitPictureInPicture().catch(() => {
        log("warn", translate("log.pipCloseFailed"))
      })
      return
    }
    void el.requestPictureInPicture().catch((error: unknown) => {
      log(
        "warn",
        translate("log.pipOpenFailed"),
        error instanceof Error ? error.message : undefined,
      )
    })
  },

  setStepMode: (mode) => {
    set({ stepMode: toStepMode(mode) })
    persistPrefs(get())
  },

  /** Hassas adım: kare modunda fps'e göre, ms modlarında sabit süreyle sarar. */
  step: (count) => {
    const el = videoEl
    if (!el || !Number.isFinite(count) || count === 0) return

    const mode = get().stepMode
    const current = el.currentTime || 0

    if (mode === "frame") {
      const fps = useStudioStore.getState().meta?.fps
      const rate = fps && fps > 0 ? fps : FALLBACK_FPS
      // 1 ms tolerans: tarayıcı seek hedefini kare sınırının bir tık altına
      // yuvarlayabiliyor; tolerans olmadan adım aynı kareye takılı kalır.
      // (1 ms, 240 fps'te bile kare süresinin çok altındadır.)
      const exact = current * rate
      const frame = Math.floor(exact + 0.001 * rate)
      const target = (frame + count) / rate
      get().seek(target < 0 ? 0 : target)
      return
    }

    get().seek(current + (STEP_MS[mode] / 1000) * count)
  },
}))
