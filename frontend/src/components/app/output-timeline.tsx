/** Çıktı zaman çizelgesi: kesilen aralıkların çıkarıldığı sıkıştırılmış görünüm.
 *
 * Üstteki çizelge kaynak zamanını (boşluklarla) gösterir; buradaki şerit ise
 * dışa aktarılacak sonucu gösterir: parçalar sırayla, boşluksuz. Tıklayıp
 * sürükleyerek çıktı zamanından kaynağa sarmak mümkün.
 */
import { useRef } from "react"

import { cn } from "cn"

import { useI18n } from "@/i18n"
import { clamp, compactDuration, formatTime } from "@/lib/format"
import {
  outputDuration,
  outputLayout,
  outputToSourceTime,
  sourceToOutputTime,
  useEditStore,
} from "@/stores/edit-store"
import { usePlayerStore } from "@/stores/player-store"
import { useSourceStore } from "@/stores/source-store"

export function OutputTimeline() {
  const { t } = useI18n()
  const segments = useEditStore((s) => s.segments)
  const isLive = useSourceStore((s) => s.isLive)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const seek = usePlayerStore((s) => s.seek)

  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const total = outputDuration(segments)
  const layout = outputLayout(segments)
  const headTime = sourceToOutputTime(segments, currentTime)
  const empty = isLive || total <= 0 || layout.length === 0

  const pct = (value: number) =>
    total > 0 ? clamp((value / total) * 100, 0, 100) : 0

  const seekAt = (clientX: number) => {
    const track = trackRef.current
    if (!track || total <= 0) return
    const bounds = track.getBoundingClientRect()
    if (bounds.width <= 0) return
    const outputTime = clamp((clientX - bounds.left) / bounds.width, 0, 1) * total
    seek(outputToSourceTime(segments, outputTime))
  }

  const handlePointerDown = (event: React.PointerEvent) => {
    if (empty) return
    event.preventDefault()
    draggingRef.current = true
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* sentetik olaylarda yakalama başarısız olabilir */
    }
    seekAt(event.clientX)
  }

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!draggingRef.current) return
    seekAt(event.clientX)
  }

  const handlePointerUp = (event: React.PointerEvent) => {
    draggingRef.current = false
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      /* yok sayılır */
    }
  }

  return (
    <div data-slot="output-timeline" className="flex items-center gap-2 px-2">
      <span className="shrink-0 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {t("outputTimeline.label")}
      </span>

      <div
        ref={trackRef}
        role="slider"
        aria-label={t("outputTimeline.hint")}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={empty ? 0 : headTime}
        data-slot="output-timeline-track"
        title={empty ? t("outputTimeline.empty") : t("outputTimeline.hint")}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={cn(
          "relative h-6 min-w-0 flex-1 touch-none overflow-hidden rounded-md bg-muted/50 ring-1 ring-foreground/10",
          empty ? "cursor-default" : "cursor-pointer",
        )}
      >
        {!empty &&
          layout.map(({ segment, start, end }) => (
            <div
              key={segment.id}
              data-slot="output-piece"
              title={`${formatTime(segment.start, true)} – ${formatTime(segment.end, true)}`}
              className="absolute inset-y-0.5 rounded-[3px] bg-linear-to-r from-emerald-400/45 to-emerald-400/25 ring-1 ring-emerald-500/30"
              style={{
                left: `${pct(start)}%`,
                width: `${Math.max(0, pct(end) - pct(start))}%`,
              }}
            />
          ))}

        {!empty && (
          <div
            data-slot="output-playhead"
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 rounded-full bg-destructive shadow-sm"
            style={{ left: `${pct(headTime)}%` }}
          />
        )}

        {empty && (
          <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
            {t("outputTimeline.empty")}
          </span>
        )}
      </div>

      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
        {empty ? "—" : compactDuration(total)}
      </span>
    </div>
  )
}
