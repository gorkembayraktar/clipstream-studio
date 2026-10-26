/** Zaman çizelgesi araç çubuğu: kaba/hassas atlama, giriş-çıkış ve seçim eylemleri. */
import {
  CirclePlayIcon,
  RepeatIcon,
  RotateCcwIcon,
  RotateCwIcon,
  StepBackIcon,
  StepForwardIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useI18n, type TranslationKey } from "@/i18n"
import {
  getVideoElement,
  SEEK_BACK_SECONDS,
  SEEK_FORWARD_SECONDS,
  STEP_MODES,
  usePlayerStore,
  type StepMode,
} from "@/stores/player-store"
import { useEditStore } from "@/stores/edit-store"
import { useSourceStore } from "@/stores/source-store"
import {
  MAX_TIMELINE_ZOOM,
  MIN_TIMELINE_ZOOM,
  TIMELINE_ZOOM_LEVELS,
  useTimelineStore,
} from "@/stores/timeline-store"

const STEP_LABEL_KEYS: Record<StepMode, TranslationKey> = {
  frame: "step.frame",
  ms10: "step.ms10",
  ms50: "step.ms50",
  ms100: "step.ms100",
  ms250: "step.ms250",
  ms500: "step.ms500",
}

/** Kaba atlama düğmeleri: yön oku + saniye değeri. */
function SeekSecondsIcon({
  direction,
  seconds,
}: {
  direction: "back" | "forward"
  seconds: number
}) {
  const Icon = direction === "back" ? RotateCcwIcon : RotateCwIcon
  return (
    <span className="relative inline-flex size-4 items-center justify-center" aria-hidden="true">
      <Icon className="size-4" />
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[7px] leading-none font-semibold">
        {seconds}
      </span>
    </span>
  )
}

export function TimelineToolbar() {
  const { t } = useI18n()
  const seekBy = usePlayerStore((s) => s.seekBy)
  const stepMode = usePlayerStore((s) => s.stepMode)
  const setStepMode = usePlayerStore((s) => s.setStepMode)
  const step = usePlayerStore((s) => s.step)
  const seek = usePlayerStore((s) => s.seek)
  const trim = useEditStore((s) => s.trim)
  const setTrim = useEditStore((s) => s.setTrim)
  const loop = useEditStore((s) => s.loop)
  const setLoop = useEditStore((s) => s.setLoop)
  const duration = useSourceStore((s) => s.meta?.duration ?? 0)
  const zoom = useTimelineStore((s) => s.zoom)
  const setZoom = useTimelineStore((s) => s.setZoom)
  const zoomIn = useTimelineStore((s) => s.zoomIn)
  const zoomOut = useTimelineStore((s) => s.zoomOut)
  const resetZoom = useTimelineStore((s) => s.resetZoom)

  const currentTimeOf = () =>
    getVideoElement()?.currentTime ?? usePlayerStore.getState().currentTime

  const markIn = () => setTrim({ start: currentTimeOf() })
  const markOut = () => setTrim({ end: currentTimeOf() })
  const playSelection = () => {
    seek(trim.start)
    usePlayerStore.getState().play()
  }
  const resetSegments = useEditStore((s) => s.resetSegments)
  const resetRange = () => {
    // Tüm video: kesimler dahil her şeyi geri getirir.
    if (duration > 0) resetSegments()
  }
  const zoomPercent = Math.round(zoom * 100)
  const zoomIndex = Math.max(
    0,
    TIMELINE_ZOOM_LEVELS.findIndex((level) => level === zoom),
  )

  return (
    <div
      data-slot="timeline-toolbar"
      className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-2"
    >
      {/* Kaba atlama: 5 sn geri / 10 sn ileri */}
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => seekBy(-SEEK_BACK_SECONDS)}
          data-slot="seek-back"
          aria-label={t("player.seekBack")}
          title={t("player.seekBack")}
        >
          <SeekSecondsIcon direction="back" seconds={SEEK_BACK_SECONDS} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => seekBy(SEEK_FORWARD_SECONDS)}
          data-slot="seek-forward"
          aria-label={t("player.seekForward")}
          title={t("player.seekForward")}
        >
          <SeekSecondsIcon direction="forward" seconds={SEEK_FORWARD_SECONDS} />
        </Button>
      </div>

      {/* Hassas adım: kare ya da ms bazında ileri/geri (Shift ile ×10) */}
      <div className="flex items-center gap-1 border-l border-border/70 pl-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => step(-1)}
          data-slot="step-back"
          aria-label={t("player.stepBack", { step: t(STEP_LABEL_KEYS[stepMode]) })}
          title={t("player.stepBack", { step: t(STEP_LABEL_KEYS[stepMode]) })}
        >
          <StepBackIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => step(1)}
          data-slot="step-forward"
          aria-label={t("player.stepForward", { step: t(STEP_LABEL_KEYS[stepMode]) })}
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
      </div>

      {/* Giriş / çıkış ve seçimi oynatma */}
      <div className="flex items-center gap-1 border-l border-border/70 pl-2">
        <Button
          variant="outline"
          size="sm"
          onClick={markIn}
          data-slot="mark-in"
          title={t("player.markIn")}
          className="text-emerald-600 dark:text-emerald-400"
        >
          {t("player.in")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={markOut}
          data-slot="mark-out"
          title={t("player.markOut")}
          className="text-amber-600 dark:text-amber-400"
        >
          {t("player.out")}
        </Button>
        <Button
          size="icon-sm"
          onClick={playSelection}
          data-slot="play-selection"
          aria-label={t("player.playSelection")}
          title={t("player.playSelection")}
        >
          <CirclePlayIcon />
        </Button>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <div className="flex items-center gap-0.5">
          <Button
            variant={loop ? "secondary" : "ghost"}
            size="icon-sm"
            onClick={() => setLoop(!loop)}
            data-slot="loop-toggle"
            aria-label={t("trim.loop")}
            aria-pressed={loop}
            title={t("trim.loop")}
          >
            <RepeatIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={resetRange}
            disabled={duration <= 0}
            data-slot="reset-range"
            aria-label={t("trim.fullRange")}
            title={t("trim.fullRange")}
          >
            <RotateCcwIcon />
          </Button>
        </div>

        {/* Zaman çizelgesi yakınlaştırması: yüzde etiketi sıfırlar, altındaki kaydırıcı seviye seçer. */}
        <div
          role="group"
          aria-label={t("timeline.zoom")}
          className="flex items-center gap-0.5 border-l border-border/70 pl-2"
        >
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={zoomOut}
            disabled={zoom <= MIN_TIMELINE_ZOOM}
            data-slot="timeline-zoom-out"
            aria-label={t("timeline.zoomOut")}
            title={t("timeline.zoomOut")}
          >
            <ZoomOutIcon />
          </Button>
          <div className="flex h-7 w-14 shrink-0 flex-col items-center">
            <button
              type="button"
              onClick={resetZoom}
              data-slot="timeline-zoom-reset"
              aria-label={t("timeline.zoomResetLevel", { percent: zoomPercent })}
              title={t("timeline.zoomReset")}
              className="flex h-4 w-full items-center justify-center rounded-sm font-mono text-[10px] leading-none tabular-nums text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            >
              {zoomPercent}%
            </button>
            <input
              type="range"
              min={0}
              max={TIMELINE_ZOOM_LEVELS.length - 1}
              step={1}
              value={zoomIndex}
              onChange={(event) =>
                setZoom(
                  TIMELINE_ZOOM_LEVELS[Number(event.currentTarget.value)] ??
                    MIN_TIMELINE_ZOOM,
                )
              }
              data-slot="timeline-zoom-range"
              aria-label={t("timeline.zoom")}
              aria-valuetext={`${zoomPercent}%`}
              title={t("timeline.zoomSlider")}
              className="h-3 w-14 cursor-ew-resize appearance-none rounded-full bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background [&::-moz-range-thumb]:size-2.5 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-muted [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-muted [&::-webkit-slider-thumb]:mt-[-3px] [&::-webkit-slider-thumb]:size-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
            />
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={zoomIn}
            disabled={zoom >= MAX_TIMELINE_ZOOM}
            data-slot="timeline-zoom-in"
            aria-label={t("timeline.zoomIn")}
            title={t("timeline.zoomIn")}
          >
            <ZoomInIcon />
          </Button>
        </div>
      </div>
    </div>
  )
}
