/** Oynatıcı kontrolleri: oynat/durdur, atlama, ses, hız, tam ekran ve Giriş/Çıkış kısayolları. */
import {
  CirclePlayIcon,
  MaximizeIcon,
  MinimizeIcon,
  MoonIcon,
  PauseIcon,
  PictureInPicture2Icon,
  PlayIcon,
  RepeatIcon,
  SkipBackIcon,
  SkipForwardIcon,
  StepBackIcon,
  StepForwardIcon,
  SunIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { useFullscreen } from "@/hooks/use-fullscreen"
import { useI18n, type TranslationKey } from "@/i18n"
import { formatTime } from "@/lib/format"
import {
  getVideoElement,
  STEP_MODES,
  usePlayerStore,
  type StepMode,
} from "@/stores/player-store"
import { useStudioStore } from "@/stores/studio-store"
import { useThemeStore } from "@/stores/theme-store"

/** Hız menüsündeki hazır oynatma hızları. */
const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3]

const STEP_LABEL_KEYS: Record<StepMode, TranslationKey> = {
  frame: "step.frame",
  ms10: "step.ms10",
  ms50: "step.ms50",
  ms100: "step.ms100",
  ms250: "step.ms250",
  ms500: "step.ms500",
}

export function PlayerControls() {
  const { t } = useI18n()
  const playing = usePlayerStore((s) => s.playing)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const volume = usePlayerStore((s) => s.volume)
  const muted = usePlayerStore((s) => s.muted)
  const playbackRate = usePlayerStore((s) => s.playbackRate)
  const pipActive = usePlayerStore((s) => s.pipActive)
  const pipSupported = usePlayerStore((s) => s.pipSupported)
  const toggle = usePlayerStore((s) => s.toggle)
  const seek = usePlayerStore((s) => s.seek)
  const seekBy = usePlayerStore((s) => s.seekBy)
  const setVolume = usePlayerStore((s) => s.setVolume)
  const toggleMute = usePlayerStore((s) => s.toggleMute)
  const setPlaybackRate = usePlayerStore((s) => s.setPlaybackRate)
  const togglePip = usePlayerStore((s) => s.togglePip)
  const stepMode = usePlayerStore((s) => s.stepMode)
  const setStepMode = usePlayerStore((s) => s.setStepMode)
  const step = usePlayerStore((s) => s.step)

  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen()

  const loop = useStudioStore((s) => s.loop)
  const setLoop = useStudioStore((s) => s.setLoop)
  const trim = useStudioStore((s) => s.trim)
  const setTrim = useStudioStore((s) => s.setTrim)

  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)

  const currentTimeOf = () => getVideoElement()?.currentTime ?? usePlayerStore.getState().currentTime

  const markIn = () => setTrim({ start: currentTimeOf() })
  const markOut = () => setTrim({ end: currentTimeOf() })
  const playSelection = () => {
    seek(trim.start)
    usePlayerStore.getState().play()
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button variant="ghost" size="icon-sm" onClick={() => seekBy(-1)} title={t("player.seekBack")}>
        <SkipBackIcon />
      </Button>
      <Button size="icon-sm" onClick={toggle} title={t("player.playPause")}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={() => seekBy(1)} title={t("player.seekForward")}>
        <SkipForwardIcon />
      </Button>

      <div className="mx-1 h-4 w-px bg-border" />

      {/* Hassas adım: kare ya da ms bazında ileri/geri (Shift ile ×10) */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => step(-1)}
        data-slot="step-back"
        title={t("player.stepBack", { step: t(STEP_LABEL_KEYS[stepMode]) })}
      >
        <StepBackIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => step(1)}
        data-slot="step-forward"
        title={t("player.stepForward", { step: t(STEP_LABEL_KEYS[stepMode]) })}
      >
        <StepForwardIcon />
      </Button>
      <Select value={stepMode} onValueChange={(value) => setStepMode(value as StepMode)}>
        <SelectTrigger
          size="sm"
          className="w-[92px] text-xs tabular-nums"
          aria-label={t("player.stepSize")}
          title={t("player.stepSizeTitle")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="start" className="min-w-[92px]">
          {STEP_MODES.map((mode) => (
            <SelectItem key={mode} value={mode} className="text-xs tabular-nums">
              {t(STEP_LABEL_KEYS[mode])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="ml-1 font-mono text-xs tabular-nums text-muted-foreground">
        {formatTime(currentTime, true)}
        <span className="mx-1 text-muted-foreground/40">/</span>
        {formatTime(duration)}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {/* Oynatma hızı */}
        <Select value={String(playbackRate)} onValueChange={(value) => setPlaybackRate(Number(value))}>
          <SelectTrigger
            size="sm"
            className="w-[72px] text-xs tabular-nums"
            aria-label={t("player.playbackRate")}
            title={t("player.playbackRate")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end" className="min-w-[72px]">
            {PLAYBACK_RATES.map((rate) => (
              <SelectItem key={rate} value={String(rate)} className="text-xs tabular-nums">
                {rate}x
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="mx-0.5 h-4 w-px bg-border" />

        <Button
          variant={loop ? "secondary" : "ghost"}
          size="icon-sm"
          onClick={() => setLoop(!loop)}
          title={t("player.loop")}
        >
          <RepeatIcon />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleMute}
          title={muted ? t("player.unmute") : t("player.mute")}
        >
          {muted || volume === 0 ? <VolumeXIcon /> : <Volume2Icon />}
        </Button>
        <Slider
          className="w-20"
          value={[Math.round(volume * 100)]}
          max={100}
          step={1}
          aria-label={t("player.volume")}
          title={t("player.volumeTitle")}
          onValueChange={(values) => setVolume((values[0] ?? 0) / 100)}
        />

        <div className="mx-0.5 h-4 w-px bg-border" />

        <Button variant="outline" size="xs" onClick={markIn} title={t("player.markIn")} className="text-emerald-600 dark:text-emerald-400">
          {t("player.in")}
        </Button>
        <Button variant="outline" size="xs" onClick={markOut} title={t("player.markOut")} className="text-amber-600 dark:text-amber-400">
          {t("player.out")}
        </Button>
        <Button size="xs" onClick={playSelection} title={t("player.playSelection")}>
          <CirclePlayIcon />
          {t("player.playSelection")}
        </Button>

        <div className="mx-0.5 h-4 w-px bg-border" />

        <Button
          variant={pipActive ? "secondary" : "ghost"}
          size="icon-sm"
          onClick={togglePip}
          disabled={!pipSupported}
          title={t("player.pip")}
        >
          <PictureInPicture2Icon />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={toggleFullscreen} title={t("player.fullscreen")}>
          {isFullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleTheme}
          data-slot="theme-toggle"
          title={theme === "dark" ? t("player.themeLight") : t("player.themeDark")}
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </Button>
      </div>
    </div>
  )
}
