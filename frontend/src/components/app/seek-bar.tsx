/** Videonun altındaki ince ilerleme çubuğu: ilerlemeyi gösterir, tıkla/sürükle ile atlar. */
import { useRef, useState } from "react"

import { cn } from "cn"

import { clamp, formatTime } from "@/lib/format"
import { usePlayerStore } from "@/stores/player-store"

/** İmleç balonunun çubuk kenarlarından taşmaması için en küçük kenar boşluğu (px). */
const EDGE_PADDING = 32

export function SeekBar({ className }: { className?: string }) {
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const bufferedEnd = usePlayerStore((s) => s.bufferedEnd)
  const seek = usePlayerStore((s) => s.seek)

  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [hover, setHover] = useState<{ left: number; time: number } | null>(null)

  const ready = duration > 0
  const percent = (time: number) => (ready ? clamp((time / duration) * 100, 0, 100) : 0)

  const timeAt = (clientX: number) => {
    const track = trackRef.current
    if (!track || !ready) return 0
    const bounds = track.getBoundingClientRect()
    return clamp((clientX - bounds.left) / (bounds.width || 1), 0, 1) * duration
  }

  const readHover = (clientX: number) => {
    const track = trackRef.current
    if (!track || !ready) return
    const bounds = track.getBoundingClientRect()
    setHover({
      left: clamp(clientX - bounds.left, EDGE_PADDING, Math.max(EDGE_PADDING, bounds.width - EDGE_PADDING)),
      time: timeAt(clientX),
    })
  }

  const handlePointerDown = (event: React.PointerEvent) => {
    if (!ready) return
    event.preventDefault()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* sentetik olaylarda yakalama başarısız olabilir */
    }
    draggingRef.current = true
    readHover(event.clientX)
    seek(timeAt(event.clientX))
  }

  const handlePointerMove = (event: React.PointerEvent) => {
    readHover(event.clientX)
    if (draggingRef.current) seek(timeAt(event.clientX))
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
    <div
      role="slider"
      aria-label="Video ilerleme çubuğu"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
      title="Tıkla ya da sürükle: videoda o konuma atla"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={() => {
        if (!draggingRef.current) setHover(null)
      }}
      className={cn(
        "group/seek relative touch-none pb-2 select-none",
        ready ? "cursor-pointer" : "cursor-default",
        className,
      )}
    >
      {/* İnce çubuk: videoya bitişik (top 0) */}
      <div ref={trackRef} className="relative h-1 w-full">
        <div className="absolute inset-0 overflow-hidden rounded-full bg-foreground/15">
          {/* Tampon belleği */}
          <div
            className="absolute inset-y-0 left-0 bg-foreground/25"
            style={{ width: `${percent(bufferedEnd)}%` }}
          />
          {/* Oynatılan bölüm */}
          <div
            data-slot="seek-progress"
            className="absolute inset-y-0 left-0 bg-primary"
            style={{ width: `${percent(currentTime)}%` }}
          />
        </div>

        {/* Tutamaç */}
        {ready && (
          <div
            data-slot="seek-thumb"
            className="pointer-events-none absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-background transition-transform group-hover/seek:scale-150"
            style={{ left: `${percent(currentTime)}%` }}
          />
        )}
      </div>

      {/* İmleç konumu balonu */}
      {hover && ready && (
        <span
          data-slot="seek-tooltip"
          className="pointer-events-none absolute top-2 -translate-x-1/2 rounded bg-popover px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-popover-foreground ring-1 ring-foreground/15"
          style={{ left: `${hover.left}px` }}
        >
          {formatTime(hover.time)}
        </span>
      )}
    </div>
  )
}
