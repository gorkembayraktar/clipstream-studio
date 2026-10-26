/** Kaynak şeridi: tüm kaynağın genel bakışı (kaldırılan aralıklar işaretli).
 *
 * Ana çizelge kesimleri birleştirip çıktı zamanında gösterir; bu şerit ise
 * kaynağın tamamını kaynak zamanında gösterir. Kaldırılan aralıklar kırmızı
 * taramayla görünür; kırmızı alanın başlangıç/bitiş çubukları sürüklenerek
 * kesim daraltılıp genişletilebilir, alana tıklanınca kesim geri alınır.
 *
 * Şerit her zaman tam genişliğe sığar (yakınlaştırma yok); tıklayıp
 * sürükleyerek kaynak zamanında sarma yapılır ve hover'da kare önizlemesi
 * gösterilir.
 */
import { useEffect, useMemo, useRef, useState } from "react"

import { useStoryboardData } from "@/components/app/storyboard-provider"
import { PREVIEW_WIDTH, TimelinePreview } from "@/components/app/timeline-preview"
import { WaveformLayer } from "@/components/app/waveform-layer"
import { useSourceDuration } from "@/hooks/use-source-duration"
import { useI18n } from "@/i18n"
import { clamp, compactDuration, formatTick, formatTime, tickStep } from "@/lib/format"
import { gapsOf, useEditStore } from "@/stores/edit-store"
import { usePlayerStore } from "@/stores/player-store"

/** Çentik etiketleri arasında hedeflenen en az boşluk (px). */
const TICK_MIN_SPACING = 80

/** Dikey (90° döndürülmüş) çentik etiketinde karakter başına yükseklik (px). */
const TICK_CHAR_HEIGHT = 5.5

/** Kaldırılan aralıkların çapraz tarama deseni. */
const CUT_STRIPES =
  "repeating-linear-gradient(45deg, rgb(248 113 113 / 0.38) 0 5px, rgb(248 113 113 / 0.12) 5px 10px)"

export function SourceTimeline() {
  const { t } = useI18n()
  const duration = useSourceDuration()
  const segments = useEditStore((s) => s.segments)
  const trim = useEditStore((s) => s.trim)
  const restoreRange = useEditStore((s) => s.restoreRange)
  const updateSegmentEdge = useEditStore((s) => s.updateSegmentEdge)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const seek = usePlayerStore((s) => s.seek)
  const { meta: storyboard, failed: storyboardFailed } = useStoryboardData()

  const wrapperRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const edgeDragRef = useRef<{ segmentId: string; edge: "start" | "end" } | null>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<{ left: number; time: number } | null>(null)

  const gaps = useMemo(() => gapsOf(segments, trim), [segments, trim])

  /** Her kesim boşluğunun komşu segmentleri (kırmızı kenarları sürüklemek için). */
  const gapEdges = useMemo(
    () =>
      gaps.map((gap) => ({
        gap,
        before: segments.find((segment) => Math.abs(segment.end - gap.start) < 1e-4) ?? null,
        after: segments.find((segment) => Math.abs(segment.start - gap.end) < 1e-4) ?? null,
      })),
    [gaps, segments],
  )

  useEffect(() => {
    const track = trackRef.current
    if (!track) return

    const measure = () => setWidth(track.clientWidth)
    measure()

    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(track)
    return () => observer.disconnect()
  }, [])

  const ticks = useMemo(() => {
    if (duration <= 0) return { step: 1, items: [] as Array<{ time: number; label: string }>, height: 0 }
    const laneWidth = width > 0 ? width : 600
    const divisions = Math.max(2, Math.floor(laneWidth / TICK_MIN_SPACING))
    const step = tickStep(duration / divisions)
    const items: Array<{ time: number; label: string }> = []
    for (let index = 0; index * step <= duration + 1e-9; index += 1) {
      const time = index * step
      items.push({ time, label: formatTick(time, step) })
    }
    // Etiketler dikey yazıldığı için yükseklik en uzun etikete göre hesaplanır.
    const longest = items.reduce((max, item) => Math.max(max, item.label.length), 0)
    return { step, items, height: 6 + Math.max(1, longest) * TICK_CHAR_HEIGHT }
  }, [duration, width])

  /** Kaynak zamanı için yüzde konumu (şerit her zaman tam genişlik). */
  const pct = (time: number) =>
    duration > 0 ? clamp((time / duration) * 100, 0, 100) : 0

  const timeAt = (clientX: number) => {
    const track = trackRef.current
    if (!track || duration <= 0) return 0
    const bounds = track.getBoundingClientRect()
    if (bounds.width <= 0) return 0
    return clamp((clientX - bounds.left) / bounds.width, 0, 1) * duration
  }

  const handlePointerDown = (event: React.PointerEvent) => {
    event.preventDefault()
    draggingRef.current = true
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* sentetik olaylarda yakalama başarısız olabilir */
    }
    seek(timeAt(event.clientX))
  }

  const handlePointerMove = (event: React.PointerEvent) => {
    // Kırmızı kesim kenarı sürüklemesi: segment sınırını kaynak zamanında taşır.
    const edge = edgeDragRef.current
    if (edge) {
      updateSegmentEdge(edge.segmentId, edge.edge, timeAt(event.clientX))
      return
    }

    const wrapper = wrapperRef.current
    const half = PREVIEW_WIDTH / 2 + 4
    if (wrapper) {
      const bounds = wrapper.getBoundingClientRect()
      const x = clamp(event.clientX - bounds.left, 0, bounds.width)
      setHover({
        left: clamp(x, half, Math.max(half, bounds.width - half)),
        time: timeAt(event.clientX),
      })
    }
    if (draggingRef.current) seek(timeAt(event.clientX))
  }

  const handlePointerUp = (event: React.PointerEvent) => {
    draggingRef.current = false
    edgeDragRef.current = null
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      /* yok sayılır */
    }
  }

  /** Kırmızı alanın başlangıç/bitiş çubuğunu sürükle (komşu segment kenarı). */
  const beginGapDrag =
    (segmentId: string, edge: "start" | "end") => (event: React.PointerEvent) => {
      event.preventDefault()
      event.stopPropagation()
      edgeDragRef.current = { segmentId, edge }
      try {
        trackRef.current?.setPointerCapture(event.pointerId)
      } catch {
        /* sentetik olaylarda yakalama başarısız olabilir */
      }
    }

  // Sonlu bir kaynak yoksa (canlı yayın veya henüz yükleme) şerit gösterilmez.
  if (duration <= 0) return null

  return (
    <div ref={wrapperRef} data-slot="source-timeline" className="relative min-w-0">
      <div className="flex items-start gap-2 px-2">
        <span className="flex h-6 shrink-0 items-center text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {t("sourceTimeline.label")}
        </span>

        <div className="min-w-0 flex-1">
          <div
            ref={trackRef}
            role="slider"
            aria-label={t("sourceTimeline.hint")}
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={currentTime}
            data-slot="source-timeline-track"
            title={t("sourceTimeline.hint")}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={() => setHover(null)}
            className="relative h-6 cursor-pointer touch-none overflow-hidden rounded-md bg-muted/50 ring-1 ring-foreground/10"
          >
            {/* Tam kaynak dalga formu (ana çizelgeyle aynı veri) */}
            <WaveformLayer duration={duration} zoom={1} />

            {/* Kalan parçalar */}
            {segments.map((segment) => (
              <div
                key={segment.id}
                data-slot="source-piece"
                className="absolute inset-y-0 rounded-[2px] bg-emerald-400/15 ring-1 ring-emerald-400/25 ring-inset"
                style={{
                  left: `${pct(segment.start)}%`,
                  width: `${Math.max(0, pct(segment.end) - pct(segment.start))}%`,
                }}
              />
            ))}

            {/* Kaldırılan aralıklar: kırmızı tarama + tıklayınca geri al */}
            {gapEdges.map(({ gap }) => (
              <div
                key={`gap-${gap.start}`}
                data-slot="source-cut"
                className="group/cut absolute inset-y-0 z-10 border-x border-red-400/60"
                style={{
                  left: `${pct(gap.start)}%`,
                  width: `${Math.max(0, pct(gap.end) - pct(gap.start))}%`,
                  backgroundImage: CUT_STRIPES,
                }}
              >
                <button
                  type="button"
                  aria-label={t("trim.restoreCutAria", {
                    start: formatTime(gap.start, true),
                    end: formatTime(gap.end, true),
                  })}
                  title={t("trim.restoreCut")}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    restoreRange(gap)
                  }}
                  className="absolute inset-0 grid cursor-pointer place-items-center"
                >
                  <span className="rounded-full bg-background/85 px-1 text-[10px] leading-4 text-foreground opacity-0 ring-1 ring-border transition-opacity group-hover/cut:opacity-100 focus-visible:opacity-100">
                    ↺
                  </span>
                </button>
              </div>
            ))}

            {/* Kesim kenarları: kırmızı alanın başlangıç/bitiş çubukları sürüklenebilir */}
            {gapEdges.map(({ gap, before }) =>
              before ? (
                <div
                  key={`gap-start-${gap.start}`}
                  role="slider"
                  aria-label={t("timeline.cutEnd")}
                  aria-valuenow={gap.start}
                  title={t("timeline.cutEnd")}
                  onPointerDown={beginGapDrag(before.id, "end")}
                  className="absolute inset-y-0 z-20 w-3 -translate-x-1/2 cursor-ew-resize touch-none"
                  style={{ left: `${pct(gap.start)}%` }}
                >
                  <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-red-400" />
                  <div className="pointer-events-none absolute top-1/2 left-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-red-400" />
                </div>
              ) : null,
            )}
            {gapEdges.map(({ gap, after }) =>
              after ? (
                <div
                  key={`gap-end-${gap.start}`}
                  role="slider"
                  aria-label={t("timeline.cutStart")}
                  aria-valuenow={gap.end}
                  title={t("timeline.cutStart")}
                  onPointerDown={beginGapDrag(after.id, "start")}
                  className="absolute inset-y-0 z-20 w-3 -translate-x-1/2 cursor-ew-resize touch-none"
                  style={{ left: `${pct(gap.end)}%` }}
                >
                  <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-red-400" />
                  <div className="pointer-events-none absolute top-1/2 left-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-red-400" />
                </div>
              ) : null,
            )}

            {/* Hover konumu */}
            {hover && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 z-10 w-px bg-foreground/30"
                style={{ left: `${pct(hover.time)}%` }}
              />
            )}

            {/* Oynatma imleci */}
            <div
              data-slot="source-playhead"
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 rounded-full bg-destructive shadow-sm"
              style={{ left: `${pct(currentTime)}%` }}
            />
          </div>

          {/* Zaman damgaları: kaynak zamanı — dikey yazılır ki birbirine girmesin */}
          <div
            data-slot="source-ticks"
            aria-hidden
            className="relative mt-0.5"
            style={{ height: ticks.height }}
          >
            {ticks.items.map(({ time, label }) => {
              const first = time <= 0
              const last = time + ticks.step > duration + 1e-9
              return (
                <span
                  key={time}
                  data-slot="source-tick"
                  className="absolute top-0 flex flex-col items-center gap-0.5 whitespace-nowrap text-muted-foreground"
                  style={{
                    left: `${pct(time)}%`,
                    transform: first
                      ? undefined
                      : last
                        ? "translateX(-100%)"
                        : "translateX(-50%)",
                  }}
                >
                  <span className="block h-1 w-px bg-foreground/20" />
                  <span className="block text-[9px] leading-none tabular-nums [writing-mode:vertical-rl]">
                    {label}
                  </span>
                </span>
              )
            })}
          </div>
        </div>

        <span className="flex h-6 shrink-0 items-center font-mono text-[11px] tabular-nums text-muted-foreground">
          {compactDuration(duration)}
        </span>
      </div>

      {/* Hover'da kare önizlemesi */}
      {hover && (
        <TimelinePreview
          left={hover.left}
          time={hover.time}
          meta={storyboard}
          failed={storyboardFailed}
        />
      )}
    </div>
  )
}
