/** Sahne üzerindeki sade oynatma çubuğu: zaman, oynat, ses, hız, PiP ve tam ekran. */
import {
  MaximizeIcon,
  MinimizeIcon,
  PauseIcon,
  PictureInPicture2Icon,
  PlayIcon,
  RadioIcon,
  SkipForwardIcon,
  TvIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react"

import { RecorderControls } from "@/components/app/recorder-controls"
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
import { useI18n } from "@/i18n"
import { cn } from "cn"
import { LIVE_BUTTON_PLAYING_THRESHOLD, LIVE_BUTTON_THRESHOLD, usePlayerStore } from "@/stores/player-store"
import { useSourceStore } from "@/stores/source-store"

/** Hız menüsündeki hazır oynatma hızları. */
const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3]

/** Beyaz videolarda da okunabilmesi için sahne kontrollerinin koyu zemini. */
const OVERLAY_CONTROL =
  "bg-black/50 text-white/80 shadow-[0_2px_10px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur-sm hover:bg-black/70 hover:text-white"

/** Sahne çubuğu için kısa süre biçimi: 00:19 / 1:02:03. */
function formatTransportTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}

export function StageControls() {
  const { t } = useI18n()
  const playing = usePlayerStore((s) => s.playing)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const isLive = useSourceStore((s) => s.isLive)
  const streamId = useSourceStore((s) => s.streamId)
  const liveUrl = useSourceStore((s) => s.liveUrl)
  const previewLive = useSourceStore((s) => s.previewLive)
  const setPreviewLive = useSourceStore((s) => s.setPreviewLive)
  /** Kayıtlar var ama canlı adres de biliniyor: sahne canlıya çevrilebilir. */
  const canWatchLive = Boolean(streamId && liveUrl)
  const live = usePlayerStore((s) => s.live)
  const liveEdge = usePlayerStore((s) => s.liveEdge)
  const goLive = usePlayerStore((s) => s.goLive)
  const volume = usePlayerStore((s) => s.volume)
  const muted = usePlayerStore((s) => s.muted)
  const playbackRate = usePlayerStore((s) => s.playbackRate)
  const pipActive = usePlayerStore((s) => s.pipActive)
  const pipSupported = usePlayerStore((s) => s.pipSupported)
  const toggle = usePlayerStore((s) => s.toggle)
  const setVolume = usePlayerStore((s) => s.setVolume)
  const toggleMute = usePlayerStore((s) => s.toggleMute)
  const setPlaybackRate = usePlayerStore((s) => s.setPlaybackRate)
  const togglePip = usePlayerStore((s) => s.togglePip)

  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen()

  // Canlı uç her manifest yenilemesinde bir segment ileri sıçrar; bu yüzden
  // düğme yalnızca belirgin biçimde geride kalınca çıkar (duraklatılmışken
  // eşik küçük, oynarken büyük). Tek karelik dalgalanmalar düğmeyi titretmez.
  const liveGap = liveEdge - currentTime
  const behindLive =
    live &&
    liveGap >
      (playing ? LIVE_BUTTON_PLAYING_THRESHOLD : LIVE_BUTTON_THRESHOLD)

  return (
    <div
      data-slot="stage-controls"
      className="absolute inset-x-0 bottom-0 z-30 px-3 pb-3"
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="pointer-events-auto">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <div className="flex min-w-0 items-center gap-2 justify-self-start">
            <div className="inline-flex h-7 min-w-0 items-center justify-self-start rounded-md bg-black/50 px-2 font-mono text-[11px] tabular-nums whitespace-nowrap text-white/70 shadow-[0_2px_10px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur-sm">
              {isLive || live ? (
                // Canlı yayında bitiş süresi bilinmez; "LIVE" etiketi sağ üstteki
                // durum rozetinde. Burada yalnızca pencere içindeki konum verilir.
                <span className="text-white/90">
                  {formatTransportTime(currentTime)}
                </span>
              ) : (
                <>
                  <span className="text-white/90">{formatTransportTime(currentTime)}</span>
                  <span className="mx-1 text-white/30">/</span>
                  <span>{formatTransportTime(duration)}</span>
                </>
              )}
            </div>

            {/* Kayıt alındıktan sonra sahneyi canlı yayına çevirme düğmesi.
                Yalnızca görüntü modunu değiştirir; proje ve kayıtlar korunur. */}
            {canWatchLive ? (
              <button
                type="button"
                onClick={() => setPreviewLive(!previewLive)}
                title={
                  previewLive
                    ? t("player.backToRecordingTitle")
                    : t("player.watchLiveTitle")
                }
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2 font-sans text-[11px] font-semibold tracking-wide whitespace-nowrap shadow-[0_2px_10px_rgba(0,0,0,0.45)] ring-1 backdrop-blur-sm transition-colors",
                  previewLive
                    ? "bg-red-600/90 text-white ring-red-300/40 hover:bg-red-600"
                    : "bg-black/50 text-white/90 ring-white/10 hover:bg-black/70 hover:text-white",
                )}
              >
                {previewLive ? (
                  <TvIcon className="size-3.5" />
                ) : (
                  <RadioIcon className="size-3.5" />
                )}
                {previewLive
                  ? t("player.backToRecording")
                  : t("player.watchLive")}
              </button>
            ) : null}

            {/* Canlı yayında düğme yerini korur; yalnızca görünürlüğü değişir ki
                kayıt düğmesi ileri geri kaymasın. */}
            {live ? (
              <button
                type="button"
                onClick={goLive}
                title={t("player.goLiveTitle")}
                aria-hidden={!behindLive}
                tabIndex={behindLive ? 0 : -1}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md bg-black/50 px-2 font-sans text-[11px] font-semibold tracking-wide whitespace-nowrap text-white/90 shadow-[0_2px_10px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur-sm transition-opacity duration-200 hover:bg-black/70 hover:text-white",
                  behindLive ? "opacity-100" : "pointer-events-none opacity-0",
                )}
              >
                <SkipForwardIcon className="size-3.5" />
                {t("player.goLive")}
              </button>
            ) : null}

            <RecorderControls />
          </div>

          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              aria-label={t("player.playPause")}
              title={t("player.playPause")}
              className="size-9 rounded-full bg-black/55 text-white shadow-[0_2px_12px_rgba(0,0,0,0.5)] ring-1 ring-white/10 backdrop-blur-sm hover:bg-black/75 hover:text-white"
            >
              {playing ? (
                <PauseIcon className="size-5 fill-current" />
              ) : (
                <PlayIcon className="size-5 fill-current" />
              )}
            </Button>
          </div>

          <div className="flex items-center justify-end gap-1">
            <div className="group/volume relative">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleMute}
                aria-label={muted ? t("player.unmute") : t("player.mute")}
                title={muted ? t("player.unmute") : t("player.mute")}
                className={OVERLAY_CONTROL}
              >
                {muted || volume === 0 ? <VolumeXIcon /> : <Volume2Icon />}
              </Button>

              {/* Ses kaydırıcısı yalnızca gerektiğinde açılır; alt çubuk sade kalır. */}
              <div className="pointer-events-none absolute bottom-full left-1/2 z-40 w-28 -translate-x-1/2 pb-2 opacity-0 transition-opacity group-hover/volume:pointer-events-auto group-hover/volume:opacity-100 group-focus-within/volume:pointer-events-auto group-focus-within/volume:opacity-100">
                <div className="rounded-lg border border-white/10 bg-black/85 p-2.5 shadow-xl backdrop-blur">
                  <Slider
                    value={[Math.round(volume * 100)]}
                    max={100}
                    step={1}
                    aria-label={t("player.volume")}
                    title={t("player.volumeTitle")}
                    onValueChange={(values) => setVolume((values[0] ?? 0) / 100)}
                    className="[&_[data-slot=slider-range]]:bg-white [&_[data-slot=slider-thumb]]:border-white [&_[data-slot=slider-track]]:bg-white/20"
                  />
                </div>
              </div>
            </div>

            <Select
              value={String(playbackRate)}
              onValueChange={(value) => setPlaybackRate(Number(value))}
            >
              <SelectTrigger
                size="sm"
                className="w-[48px] justify-center border-transparent bg-black/50 px-1 text-[11px] font-medium text-white/80 tabular-nums shadow-[0_2px_10px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur-sm hover:bg-black/70 hover:text-white focus-visible:border-white/30 focus-visible:ring-white/20 data-[size=sm]:rounded-md dark:bg-black/50 dark:hover:bg-black/70 [&_svg]:hidden"
                aria-label={t("player.playbackRate")}
                title={t("player.playbackRate")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="center" className="min-w-[72px]">
                {PLAYBACK_RATES.map((rate) => (
                  <SelectItem key={rate} value={String(rate)} className="text-xs tabular-nums">
                    {rate}x
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="ghost"
              size="icon-sm"
              onClick={togglePip}
              disabled={!pipSupported}
              aria-label={t("player.pip")}
              title={t("player.pip")}
              className={cn(
                OVERLAY_CONTROL,
                pipActive && "bg-black/70 text-white ring-white/25 hover:bg-black/75",
              )}
            >
              <PictureInPicture2Icon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleFullscreen}
              aria-label={t("player.fullscreen")}
              title={t("player.fullscreen")}
              className={OVERLAY_CONTROL}
            >
              {isFullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
