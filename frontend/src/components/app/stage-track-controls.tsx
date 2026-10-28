/** Sahne çubuğu: önizleme kalitesi, ses parçası ve altyazı seçimi.
 *
 * Bu alanlar kaynak panelinden buraya taşındı: oynatma sırasında ses
 * düğmesinin solundan erişilir.
 */
import {
  AudioLinesIcon,
  CaptionsIcon,
  CheckIcon,
  Loader2,
  MonitorIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useI18n } from "@/i18n"
import { log } from "@/stores/log-store"
import { useSourceStore } from "@/stores/source-store"
import { cn } from "cn"

/** Beyaz videolarda da okunabilmesi için sahne kontrollerinin koyu zemini. */
const OVERLAY_CONTROL =
  "bg-black/50 text-white/80 shadow-[0_2px_10px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur-sm hover:bg-black/70 hover:text-white"

/** Seçili öğenin yanındaki onay işareti; boşluk korunur ki satırlar kaymasın. */
function CheckSlot({ selected }: { selected: boolean }) {
  return selected ? (
    <CheckIcon className="size-3.5" />
  ) : (
    <span className="size-3.5" aria-hidden />
  )
}

export function StageTrackControls() {
  const { t } = useI18n()

  const variants = useSourceStore((s) => s.variants)
  const previewHeight = useSourceStore((s) => s.previewHeight)
  const setPreviewHeight = useSourceStore((s) => s.setPreviewHeight)

  const audioTracks = useSourceStore((s) => s.audioTracks)
  const audioTrackId = useSourceStore((s) => s.audioTrackId)
  const audioSwitching = useSourceStore((s) => s.audioSwitching)
  const setAudioTrackId = useSourceStore((s) => s.setAudioTrackId)

  const subtitleTracks = useSourceStore((s) => s.subtitleTracks)
  const subtitleTrackId = useSourceStore((s) => s.subtitleTrackId)
  const setSubtitleTrackId = useSourceStore((s) => s.setSubtitleTrackId)

  const defaultVariant = variants.find((item) => item.default) ?? variants[0] ?? null
  const currentHeight =
    previewHeight ??
    defaultVariant?.quality_height ??
    defaultVariant?.height ??
    variants[0]?.quality_height ??
    variants[0]?.height ??
    null
  const currentVariant =
    variants.find((item) => (item.quality_height ?? item.height) === currentHeight) ??
    defaultVariant

  const currentAudioId =
    audioTrackId ??
    audioTracks.find((track) => track.default)?.id ??
    audioTracks.find((track) => track.original)?.id ??
    audioTracks[0]?.id ??
    null
  const currentAudio = audioTracks.find((track) => track.id === currentAudioId)
  const currentSubtitle = subtitleTracks.find((track) => track.id === subtitleTrackId)

  if (
    variants.length <= 1 &&
    audioTracks.length <= 1 &&
    subtitleTracks.length === 0
  ) {
    return null
  }

  return (
    <div
      data-slot="stage-track-controls"
      className="flex items-center gap-0.5"
    >
      {variants.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(OVERLAY_CONTROL, "w-auto gap-1 px-1.5")}
              aria-label={t("source.previewQualityAria")}
              title={t("source.previewQualityTitle")}
            >
              <MonitorIcon />
              <span className="hidden text-[11px] font-medium tabular-nums sm:inline">
                {currentVariant?.label ?? (currentHeight ? `${currentHeight}p` : "")}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuLabel className="text-[10px] tracking-wider text-muted-foreground uppercase">
              {t("source.previewQuality")}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {variants.map((item) => {
              const height = item.quality_height ?? item.height
              const selected = height === currentHeight
              return (
                <DropdownMenuItem
                  key={`${height}-${item.url}`}
                  onSelect={() => {
                    setPreviewHeight(height)
                    log("info", t("log.previewQuality", { height }))
                  }}
                >
                  <CheckSlot selected={selected} />
                  <span className="tabular-nums">{item.label}</span>
                  {item.default && (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {t("source.recommended")}
                    </span>
                  )}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {audioTracks.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className={OVERLAY_CONTROL}
              aria-label={t("source.audioTrackAria")}
              title={
                currentAudio
                  ? `${t("source.audioTrackTitle")}: ${currentAudio.name}`
                  : t("source.audioTrackTitle")
              }
            >
              {audioSwitching ? (
                <Loader2 className="animate-spin" />
              ) : (
                <AudioLinesIcon />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuLabel className="text-[10px] tracking-wider text-muted-foreground uppercase">
              {t("source.audioTrack")}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {audioTracks.map((track) => {
              const selected = track.id === currentAudioId
              const suffix = track.original
                ? ` · ${t("source.audioOriginal")}`
                : track.default
                  ? ` · ${t("source.audioDefault")}`
                  : ""
              const language =
                track.language &&
                track.language.toLowerCase() !== track.name.toLowerCase()
                  ? ` (${track.language.toUpperCase()})`
                  : ""
              return (
                <DropdownMenuItem
                  key={track.id}
                  onSelect={() => {
                    setAudioTrackId(track.id)
                    log("info", t("log.audioTrack", { name: track.name }))
                  }}
                >
                  <CheckSlot selected={selected} />
                  <span className="truncate">
                    {track.name}
                    {language}
                  </span>
                  {suffix && (
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      {suffix.replace(" · ", "")}
                    </span>
                  )}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {subtitleTracks.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                OVERLAY_CONTROL,
                subtitleTrackId && "bg-black/70 text-white ring-white/25",
              )}
              aria-label={t("source.subtitlesAria")}
              title={
                currentSubtitle
                  ? `${t("source.subtitlesTitle")}: ${currentSubtitle.name}`
                  : t("source.subtitlesTitle")
              }
            >
              <CaptionsIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuLabel className="text-[10px] tracking-wider text-muted-foreground uppercase">
              {t("source.subtitles")}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                setSubtitleTrackId(null)
                log("info", t("log.subtitleOff"))
              }}
            >
              <CheckSlot selected={!subtitleTrackId} />
              {t("source.subtitlesOff")}
            </DropdownMenuItem>
            {subtitleTracks.map((track) => {
              const selected = track.id === subtitleTrackId
              const language =
                track.language &&
                track.language.toLowerCase() !== track.name.toLowerCase()
                  ? ` (${track.language.toUpperCase()})`
                  : ""
              return (
                <DropdownMenuItem
                  key={track.id}
                  onSelect={() => {
                    setSubtitleTrackId(track.id)
                    log("info", t("log.subtitleTrack", { name: track.name }))
                  }}
                >
                  <CheckSlot selected={selected} />
                  <span className="truncate">
                    {track.name}
                    {language}
                  </span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
