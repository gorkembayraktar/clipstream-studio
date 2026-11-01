/** Zaman çizelgesi araç çubuğu: LosslessCut benzeri tek satır.
 *
 * Sık kullanılanlar görünür kalır (kaba sarma, hassas adım, seçimi oynatma,
 * yakınlaştırma, dışa aktarma). Nadir kullanılanlar — adım boyu, döngü, seçim
 * modu, tüm videoya dönme — "⋯" menüsüne taşınır ki şerit sade dursun.
 */
import {
  CheckIcon,
  CirclePlayIcon,
  MoreHorizontalIcon,
  RepeatIcon,
  RotateCcwIcon,
  RotateCwIcon,
  ScissorsIcon,
  SquareDashedMousePointerIcon,
  StepBackIcon,
  StepForwardIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useI18n, type TranslationKey } from "@/i18n"
import {
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
  useTimelineStore,
} from "@/stores/timeline-store"
import { useProjectUiStore } from "@/stores/project-ui-store"

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

/** Menüde onay işareti ile boşluk arasında kaymayı önleyen yer tutucu. */
function CheckSlot({ checked }: { checked: boolean }) {
  return checked ? <CheckIcon /> : <span className="size-3.5" aria-hidden />
}

export function TimelineToolbar() {
  const { t } = useI18n()
  const seekBy = usePlayerStore((s) => s.seekBy)
  const stepMode = usePlayerStore((s) => s.stepMode)
  const setStepMode = usePlayerStore((s) => s.setStepMode)
  const step = usePlayerStore((s) => s.step)
  const seek = usePlayerStore((s) => s.seek)
  const trim = useEditStore((s) => s.trim)
  const loop = useEditStore((s) => s.loop)
  const setLoop = useEditStore((s) => s.setLoop)
  const resetSegments = useEditStore((s) => s.resetSegments)
  const duration = useSourceStore((s) => s.meta?.duration ?? 0)
  const zoom = useTimelineStore((s) => s.zoom)
  const zoomIn = useTimelineStore((s) => s.zoomIn)
  const zoomOut = useTimelineStore((s) => s.zoomOut)
  const resetZoom = useTimelineStore((s) => s.resetZoom)
  const selectMode = useTimelineStore((s) => s.selectMode)
  const toggleSelectMode = useTimelineStore((s) => s.toggleSelectMode)
  const setPanelTab = useProjectUiStore((s) => s.setPanelTab)
  const setPanelOpen = useProjectUiStore((s) => s.setPanelOpen)

  const playSelection = () => {
    seek(trim.start)
    usePlayerStore.getState().play()
  }
  // Tüm video: kesimler dahil her şeyi geri getirir.
  const resetRange = () => {
    if (duration > 0) resetSegments()
  }
  const zoomPercent = Math.round(zoom * 100)
  const openExport = () => {
    setPanelTab("export")
    setPanelOpen(true)
  }

  return (
    <div
      data-slot="timeline-toolbar"
      className="flex flex-wrap items-center gap-1 px-2"
    >
      {/* Kaba atlama: 5 sn geri / 10 sn ileri */}
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

      {/* Hassas adım: kare ya da ms bazında ileri/geri (Shift ile ×10) */}
      <div className="ml-1 flex items-center gap-0.5 border-l border-border/70 pl-1.5">
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
      </div>

      {/* Seçimi baştan oynat */}
      <div className="ml-1 flex items-center gap-0.5 border-l border-border/70 pl-1.5">
        <Button
          variant="ghost"
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
        {/* Yakınlaştırma: yüzde etiketi sıfırlar. Kaydırıcı yerine üç düğme:
            şerit sade kalsın, kademeler zaten sabit. */}
        <div
          role="group"
          aria-label={t("timeline.zoom")}
          className="flex items-center gap-0.5"
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
          <button
            type="button"
            onClick={resetZoom}
            data-slot="timeline-zoom-reset"
            aria-label={t("timeline.zoomResetLevel", { percent: zoomPercent })}
            title={t("timeline.zoomReset")}
            className="flex h-7 w-11 shrink-0 items-center justify-center rounded-md font-mono text-[10px] leading-none tabular-nums text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            {zoomPercent}%
          </button>
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

        {/* Nadir ayarlar: adım boyu, döngü, seçim modu, tüm videoya dönme. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              data-slot="timeline-more"
              aria-label={t("timeline.more")}
              title={t("timeline.more")}
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <StepForwardIcon />
                <span className="min-w-0 flex-1 truncate">
                  {t("player.stepSize")}
                </span>
                <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
                  {t(STEP_LABEL_KEYS[stepMode])}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {STEP_MODES.map((mode) => (
                  <DropdownMenuItem key={mode} onSelect={() => setStepMode(mode)}>
                    <CheckSlot checked={mode === stepMode} />
                    {t(STEP_LABEL_KEYS[mode])}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />

            <DropdownMenuItem onSelect={() => setLoop(!loop)}>
              <CheckSlot checked={loop} />
              <RepeatIcon />
              {t("trim.loop")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => toggleSelectMode()}>
              <CheckSlot checked={selectMode} />
              <SquareDashedMousePointerIcon />
              {t("timeline.selectMode")}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem onSelect={resetRange} disabled={duration <= 0}>
              <RotateCcwIcon />
              {t("trim.fullRange")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Dışa aktarma paneli kapalıyken de tek tıkla erişilebilir kalsın. */}
        <Button
          size="sm"
          data-slot="open-export"
          onClick={openExport}
          title={t("timeline.exportMenu")}
        >
          <ScissorsIcon />
          {t("tabs.export")}
        </Button>
      </div>
    </div>
  )
}
