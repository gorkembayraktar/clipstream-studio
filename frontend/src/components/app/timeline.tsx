/** İnteraktif zaman çizelgesi: oynatma imleci + Giriş/Çıkış tutamaçları + kare önizleme. */
import { useCallback, useMemo, useRef, useState } from "react"
import type { CSSProperties } from "react"

import { Loader2Icon } from "lucide-react"

import { cn } from "cn"

import { WaveformLayer } from "@/components/app/waveform-layer"
import { useStoryboard } from "@/hooks/use-storyboard"
import { useI18n } from "@/i18n"
import { clamp, formatClock, formatTime } from "@/lib/format"
import type { StoryboardMeta } from "@/lib/types"
import { usePlayerStore } from "@/stores/player-store"
import { useEditStore } from "@/stores/edit-store"
import { useSourceStore } from "@/stores/source-store"

type DragTarget = "playhead" | "start" | "end" | "range"

/** Bu eşiğin altındaki imleç oynaması tıklama sayılır (aralık içinde imleç taşıma). */
const RANGE_DRAG_THRESHOLD = 4

/** Kare önizleme balonunun ölçüleri (px) — sunucu da bu ölçüde üretir. */
const PREVIEW_WIDTH = 160
const PREVIEW_HEIGHT = 90
/** Zaman çizelgesinin yuvarlatılmış kenarları tutamaçları kırpmasın diye iç boşluk. */
const TRACK_PADDING = 8

/** Pointer yakalama kenar durumlarda (ör. sentetik olaylar) hata verebilir; sürükleme yine de çalışır. */
function capturePointer(element: Element | null, pointerId: number) {
  try {
    element?.setPointerCapture(pointerId)
  } catch {
    /* yok sayılır */
  }
}

function releasePointer(element: Element | null, pointerId: number) {
  try {
    if (element?.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
  } catch {
    /* yok sayılır */
  }
}

function tickStep(duration: number): number {
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
  const target = duration / 10
  return steps.find((step) => step >= target) ?? 3600
}

/** Yüklenen gruplar arasından zamana en yakın kareyi CSS ile kırpar. */
function storyboardFrame(meta: StoryboardMeta, time: number) {
  let selected: { batch: StoryboardMeta["batches"][number]; index: number } | null = null
  let selectedDistance = Infinity

  for (const batch of meta.batches) {
    for (let index = 0; index < batch.times.length; index += 1) {
      const distance = Math.abs(batch.times[index] - time)
      if (distance < selectedDistance) {
        selectedDistance = distance
        selected = { batch, index }
      }
    }
  }

  if (!selected) return null
  const { batch, index } = selected
  const column = index % batch.columns
  const row = Math.floor(index / batch.columns)

  return {
    /** Kareyi temsil eden zaman (yaklaşık). */
    time: batch.times[index],
    style: {
      width: batch.tile_width,
      height: batch.tile_height,
      backgroundImage: `url("${batch.sheet_url}")`,
      backgroundSize: `${batch.columns * batch.tile_width}px ${batch.rows * batch.tile_height}px`,
      backgroundPosition: `-${column * batch.tile_width}px -${row * batch.tile_height}px`,
      backgroundRepeat: "no-repeat",
    } satisfies CSSProperties,
  }
}

export function Timeline() {
  const { t } = useI18n()
  const trim = useEditStore((s) => s.trim)
  const setTrim = useEditStore((s) => s.setTrim)
  const metaDuration = useSourceStore((s) => s.meta?.duration ?? 0)
  const isLive = useSourceStore((s) => s.isLive)

  const playerDuration = usePlayerStore((s) => s.duration)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const bufferedEnd = usePlayerStore((s) => s.bufferedEnd)
  const seek = usePlayerStore((s) => s.seek)

  // Canlı yayında sonlu bir süre yoktur; timeline/trim/storyboard devre dışı.
  const duration = isLive ? 0 : playerDuration || metaDuration

  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragTarget | null>(null)
  /** Aralık taşıma sürüklemesinin başlangıç durumu (imleç X + kesim sınırları). */
  const rangeRef = useRef<{ pointerX: number; start: number; end: number; moved: boolean } | null>(
    null,
  )

  const pct = useCallback(
    (time: number) => (duration > 0 ? clamp((time / duration) * 100, 0, 100) : 0),
    [duration],
  )

  const timeAt = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track || duration <= 0) return 0
      const bounds = track.getBoundingClientRect()
      return clamp((clientX - bounds.left) / bounds.width, 0, 1) * duration
    },
    [duration],
  )

  const ticks = useMemo(() => {
    if (duration <= 0) return []
    const step = tickStep(duration)
    const result: number[] = []
    for (let time = 0; time <= duration; time += step) result.push(time)
    return result
  }, [duration])

  const handleTrackPointerDown = (event: React.PointerEvent) => {
    if (duration <= 0) return
    capturePointer(event.currentTarget, event.pointerId)
    dragRef.current = "playhead"
    seek(timeAt(event.clientX))
  }

  const handlePointerMove = (event: React.PointerEvent) => {
    const track = trackRef.current
    if (track && duration > 0) {
      const bounds = track.getBoundingClientRect()
      const x = clamp(event.clientX - bounds.left, 0, bounds.width)
      // Balon çizelgenin kenarlarından taşmasın diye yatay konum sınırlanır
      const half = PREVIEW_WIDTH / 2 + 4
      setHover({ left: clamp(x, half, Math.max(half, bounds.width - half)), time: timeAt(event.clientX) })
    }

    const target = dragRef.current
    if (!target) return

    // Aralığı taşı: süre korunur, pencere [0, duration] içinde kalır
    if (target === "range") {
      const origin = rangeRef.current
      const track = trackRef.current
      if (!origin || !track) return
      // Küçük oynama tıklama sayılır (imleç taşıma); gerçek sürükleme eşiği aşınca başlar
      if (!origin.moved) {
        if (Math.abs(event.clientX - origin.pointerX) < RANGE_DRAG_THRESHOLD) return
        origin.moved = true
      }
      const width = track.getBoundingClientRect().width
      if (width <= 0) return

      const deltaTime = ((event.clientX - origin.pointerX) / width) * duration
      const span = origin.end - origin.start
      let start = origin.start + deltaTime
      if (start < 0) start = 0
      else if (start + span > duration) start = Math.max(0, duration - span)
      setTrim({ start, end: start + span })
      return
    }

    const time = timeAt(event.clientX)
    if (target === "playhead") {
      seek(time)
      return
    }

    // Tutamak diğerini geçerse mağaza noktaları takas eder; sürüklenen tutamak
    // artık karşı taraftır, sonraki hareketlerde onu güncellemeye devam et.
    if (target === "start") {
      const previousEnd = useEditStore.getState().trim.end
      setTrim({ start: time })
      if (useEditStore.getState().trim.end > previousEnd) dragRef.current = "end"
    } else {
      const previousStart = useEditStore.getState().trim.start
      setTrim({ end: time })
      if (useEditStore.getState().trim.start < previousStart) dragRef.current = "start"
    }
  }

  const handlePointerUp = (event: React.PointerEvent) => {
    // Aralığa sürüklemeden tıklandıysa oynatma imleci oraya taşınır
    if (dragRef.current === "range") {
      const origin = rangeRef.current
      if (origin && !origin.moved) seek(timeAt(event.clientX))
    }
    dragRef.current = null
    rangeRef.current = null
    releasePointer(event.currentTarget, event.pointerId)
  }

  const beginHandleDrag = (target: DragTarget) => (event: React.PointerEvent) => {
    if (duration <= 0) return
    event.preventDefault()
    event.stopPropagation()
    capturePointer(trackRef.current, event.pointerId)
    dragRef.current = target
    // Playhead zaten imlecin üzerinde; tıklama anında konumu değiştirme.
    if (target !== "playhead") seek(target === "start" ? trim.start : trim.end)
  }

  const beginRangeDrag = (event: React.PointerEvent) => {
    if (duration <= 0) return
    event.preventDefault()
    event.stopPropagation()
    capturePointer(trackRef.current, event.pointerId)
    dragRef.current = "range"
    rangeRef.current = { pointerX: event.clientX, start: trim.start, end: trim.end, moved: false }
  }

  /** Fare çizelge üzerindeyken gösterilen kare önizleme balonu. */
  const streamUrl = useSourceStore((s) => s.streamUrl)
  const [hover, setHover] = useState<{ left: number; time: number } | null>(null)
  const {
    meta: storyboard,
    failed: storyboardFailed,
  } = useStoryboard(streamUrl, duration)
  const storyboardTile =
    hover && storyboard ? storyboardFrame(storyboard, hover.time) : null

  const handlePointerLeave = () => {
    if (dragRef.current) return
    setHover(null)
  }

  const startPct = pct(trim.start)
  const endPct = pct(trim.end)

  return (
    <div className="relative select-none">
      <div className="overflow-hidden rounded-lg bg-muted/50 ring-1 ring-foreground/10">
        <div
          ref={trackRef}
          onPointerDown={handleTrackPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          className={cn(
            "relative mx-2 h-14 touch-none",
            duration > 0 ? "cursor-crosshair" : "opacity-60",
          )}
        >
          {/* Ses dalga formu (kaynak analiz edildikçe görünür) */}
          <WaveformLayer duration={duration} />

          {/* Tampon belleği */}
          <div
            className="absolute inset-y-0 left-0 bg-foreground/10"
            style={{ width: `${pct(bufferedEnd)}%` }}
          />

          {/* Seçili aralık — bütün olarak sürüklenebilir */}
          {duration > 0 && (
            <div
              data-slot="timeline-range"
              title={t("timeline.rangeTitle")}
              onPointerDown={beginRangeDrag}
              className="absolute inset-y-0 cursor-grab touch-none border-l-2 border-r-2 border-emerald-400 border-r-amber-400 bg-linear-to-r from-emerald-400/20 to-amber-400/20 active:cursor-grabbing"
              style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
            />
          )}

          {/* Çentikler ve etiketler */}
          {ticks.map((tick) => (
            <div
              key={tick}
              className="absolute top-0 bottom-0"
              style={{ left: `${pct(tick)}%` }}
            >
              <div className="absolute top-1/2 bottom-0 w-px bg-foreground/15" />
              {tick > 0 && tick < duration && (
                <span className="absolute bottom-0.5 -translate-x-1/2 text-[10px] whitespace-nowrap text-muted-foreground">
                  {formatClock(tick)}
                </span>
              )}
            </div>
          ))}

          {/* Oynatma imleci — geniş görünmez tutamaç, görünür çizgi içinde */}
          {duration > 0 && (
            <div
              role="slider"
              aria-label={t("timeline.playhead")}
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={currentTime}
              data-slot="timeline-playhead"
              title={t("timeline.playheadDrag")}
              onPointerDown={beginHandleDrag("playhead")}
              className="absolute inset-y-0 z-20 w-3 -translate-x-1/2 cursor-ew-resize touch-none"
              style={{ left: `${pct(currentTime)}%` }}
            >
              <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-red-500" />
              <div className="pointer-events-none absolute -top-0.5 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-red-500" />
            </div>
          )}

          {/* Giriş / Çıkış tutamaçları */}
          {duration > 0 && (
            <>
              <div
                role="slider"
                aria-label={t("timeline.inPoint")}
                data-slot="timeline-start"
                title={t("timeline.inPointDrag")}
                onPointerDown={beginHandleDrag("start")}
                className="absolute inset-y-0 z-30 w-3 -translate-x-1/2 cursor-ew-resize"
                style={{ left: `${startPct}%` }}
              >
                <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-emerald-400" />
                <div className="absolute top-1/2 left-1/2 h-6 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-emerald-400 bg-emerald-400" />
              </div>
              <div
                role="slider"
                aria-label={t("timeline.outPoint")}
                data-slot="timeline-end"
                title={t("timeline.outPointDrag")}
                onPointerDown={beginHandleDrag("end")}
                className="absolute inset-y-0 z-30 w-3 -translate-x-1/2 cursor-ew-resize"
                style={{ left: `${endPct}%` }}
              >
                <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-amber-400" />
                <div className="absolute top-1/2 left-1/2 h-6 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-amber-400 bg-amber-400" />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Kare önizleme balonu — çizelgenin üstünde görünür */}
      {hover && duration > 0 && (
        <div
          data-slot="timeline-preview"
          className="pointer-events-none absolute bottom-[calc(100%+6px)] z-40 -translate-x-1/2"
          style={{ left: `${hover.left + TRACK_PADDING}px` }}
        >
          <div className="overflow-hidden rounded-md border border-border/70 bg-black shadow-xl">
            <div className="relative" style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }}>
              {storyboardTile ? (
                <div style={storyboardTile.style} aria-hidden />
              ) : storyboardFailed ? (
                <div className="flex h-full w-full items-center justify-center px-3 text-center text-[10px] leading-tight text-white/60">
                  {t("timeline.storyboardFailed")}
                </div>
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-[10px] text-white/60">
                  <Loader2Icon className="size-4 animate-spin text-white/80" />
                  {t("timeline.storyboardLoading")}
                </div>
              )}
            </div>
          </div>
          <div className="mt-1 w-40 rounded bg-black/85 px-1.5 py-0.5 text-center font-mono text-[10px] text-white/90">
            <div>{formatTime(hover.time, true)}</div>
            {storyboardTile &&
              Math.abs(storyboardTile.time - hover.time) >= 0.05 && (
                <div className="text-[9px] text-white/50">
                  ≈{formatTime(storyboardTile.time, true)}
                </div>
              )}
          </div>
        </div>
      )}

      {duration <= 0 && (
        <p className="mt-1.5 text-center text-xs text-muted-foreground">
          {isLive ? t("timeline.live") : t("timeline.loadSource")}
        </p>
      )}
    </div>
  )
}
