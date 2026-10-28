/** Zaman çizelgesi şeridi: çizelge, kaynak şeridi ve kırpma çubuğu.
 *
 * Canlı yayında (henüz kayıt yokken ya da canlı önizleme açıkken) düzenlenecek
 * sonlu bir akış olmadığı için şerit yerine ince bir bilgi satırı gösterilir.
 */
import { TvIcon } from "lucide-react"

import { SourceTimeline } from "@/components/app/source-timeline"
import { StoryboardProvider } from "@/components/app/storyboard-provider"
import { Timeline } from "@/components/app/timeline"
import { TimelineToolbar } from "@/components/app/timeline-toolbar"
import { TrimBar } from "@/components/app/trim-bar"
import { WaveformProvider } from "@/components/app/waveform-provider"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/i18n"
import { cn } from "cn"
import { usePlayerStore } from "@/stores/player-store"
import { useSourceStore } from "@/stores/source-store"

export function TimelineSection() {
  const { t } = useI18n()
  const streamUrl = useSourceStore((s) => s.streamUrl)
  const isStreamSource = useSourceStore((s) => Boolean(s.streamId))
  const isLive = useSourceStore((s) => s.isLive)
  const playerLive = usePlayerStore((s) => s.live)
  const previewLive = useSourceStore((s) => s.previewLive)
  const setPreviewLive = useSourceStore((s) => s.setPreviewLive)

  const liveOnly = previewLive || (!isStreamSource && (isLive || playerLive))

  if (liveOnly) {
    return (
      <div
        data-slot="live-strip"
        className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground"
      >
        <span className="relative flex size-2">
          <span className="absolute inset-0 animate-ping rounded-full bg-red-500/60" />
          <span className="relative size-2 rounded-full bg-red-500" />
        </span>
        <span className="font-medium text-foreground">{t("stage.liveOnly")}</span>
        <span aria-hidden>·</span>
        <span>
          {isStreamSource
            ? t("stage.livePreviewHint")
            : t("stage.liveOnlyHint")}
        </span>
        {isStreamSource && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPreviewLive(false)}
            className="h-7 px-2 text-xs"
          >
            <TvIcon className="size-3.5" />
            {t("player.backToRecording")}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div
      data-slot="timeline-section"
      inert={!streamUrl}
      className={cn(
        "stage-strip min-w-0 space-y-2 border-t border-border/60 px-3 py-2.5",
        !streamUrl && "pointer-events-none opacity-60",
      )}
    >
      <TimelineToolbar />
      <WaveformProvider>
        <StoryboardProvider>
          <Timeline />
          <SourceTimeline />
        </StoryboardProvider>
      </WaveformProvider>
      <TrimBar />
    </div>
  )
}
