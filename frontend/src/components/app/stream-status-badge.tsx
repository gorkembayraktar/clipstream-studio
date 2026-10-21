/** Oynatma durumu rozeti: canlı durumu ve anlık çözünürlüğü gösterir. */
import { cn } from "cn"

import { useI18n } from "@/i18n"
import type { StatusTone } from "@/stores/player-store"
import { usePlayerStore } from "@/stores/player-store"
import { useSourceStore } from "@/stores/source-store"

const TONE_CLASSES: Record<StatusTone, string> = {
  idle: "border-white/10 bg-black/60 text-white/60",
  buffering: "border-amber-500/45 bg-amber-500/15 text-amber-200",
  ready: "border-emerald-500/35 bg-emerald-500/12 text-emerald-200",
  error: "border-red-500/50 bg-red-500/15 text-red-200",
}

const DOT_CLASSES: Record<StatusTone, string> = {
  idle: "bg-white/40",
  buffering: "bg-amber-400",
  ready: "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]",
  error: "bg-red-400",
}

export function StreamStatusBadge({ className }: { className?: string }) {
  const { t } = useI18n()
  const sourceLoading = useSourceStore((s) => s.sourceLoading)
  const hasSource = useSourceStore((s) => s.streamUrl !== null)
  const playing = usePlayerStore((s) => s.playing)
  const buffering = usePlayerStore((s) => s.buffering)
  const note = usePlayerStore((s) => s.statusNote)
  const videoWidth = usePlayerStore((s) => s.videoWidth)
  const videoHeight = usePlayerStore((s) => s.videoHeight)

  let tone: StatusTone = "idle"
  let label = t("status.noSource")

  if (sourceLoading) {
    tone = "buffering"
    label = t("status.loading")
  } else if (!hasSource) {
    tone = "idle"
    label = t("status.noSource")
  } else if (note) {
    tone = note.tone
    label = note.label
  } else if (buffering) {
    tone = "buffering"
    label = t("status.buffering")
  } else {
    tone = "ready"
    label = playing ? t("status.playing") : t("status.ready")
  }

  const detail = tone === "ready" && videoWidth > 0 ? `${videoWidth}×${videoHeight}` : null

  return (
    <div
      role="status"
      aria-live="polite"
      data-slot="stream-status-badge"
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap backdrop-blur transition-colors",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {tone === "buffering" ? (
        <span className="size-3 animate-spin rounded-full border-2 border-white/25 border-t-current" />
      ) : (
        <span className={cn("size-1.5 rounded-full", DOT_CLASSES[tone])} />
      )}
      <span>{label}</span>
      {detail && <span className="font-mono text-[10px] opacity-70">{detail}</span>}
    </div>
  )
}
