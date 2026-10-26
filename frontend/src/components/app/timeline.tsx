/** İnteraktif zaman çizelgesi: kesimler birleşik (çıktı zamanı) + oynatma imleci + kare önizleme.
 *
 * Segmentler kaynak zamanında tutulur; burada aralarındaki boşluklar
 * atlanarak bitişik gösterilir. Süre, çentikler ve imleç çıktı zamanındadır.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { ScissorsIcon } from "lucide-react"

import { cn } from "cn"

import { useStoryboardData } from "@/components/app/storyboard-provider"
import { PREVIEW_WIDTH, TimelinePreview } from "@/components/app/timeline-preview"
import { WaveformLayer } from "@/components/app/waveform-layer"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { useSourceDuration } from "@/hooks/use-source-duration"
import { useI18n } from "@/i18n"
import { clamp, formatTick, tickStep } from "@/lib/format"
import {
  layoutOf,
  outputDuration,
  outputToSourceTime,
  sourceToOutputTime,
  useEditStore,
} from "@/stores/edit-store"
import { usePlayerStore } from "@/stores/player-store"
import { useSourceStore } from "@/stores/source-store"
import { useTimelineStore } from "@/stores/timeline-store"

type DragTarget = "playhead" | "select" | "start" | "end"

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

export function Timeline() {
  const { t } = useI18n()
  const trim = useEditStore((s) => s.trim)
  const setTrim = useEditStore((s) => s.setTrim)
  const segments = useEditStore((s) => s.segments)
  const selection = useEditStore((s) => s.selection)
  const setSelection = useEditStore((s) => s.setSelection)
  const removeSelection = useEditStore((s) => s.removeSelection)
  const isLive = useSourceStore((s) => s.isLive)
  const sourceDuration = useSourceDuration()

  /** Kesimler birleştirildiği için çizelge çıktı zamanındadır. */
  const layout = useMemo(() => layoutOf(segments), [segments])
  const duration = useMemo(() => outputDuration(segments), [segments])
  /** Dalga formu için kaynak→çıktı eşlemesi (boşluklar atlanır). */
  const spans = useMemo(
    () =>
      layout.map((span) => ({
        start: span.start,
        end: span.end,
        sourceStart: span.segment.start,
        sourceEnd: span.segment.end,
        speed: span.segment.speed,
      })),
    [layout],
  )

  const currentTime = usePlayerStore((s) => s.currentTime)
  const bufferedEnd = usePlayerStore((s) => s.bufferedEnd)
  const seek = usePlayerStore((s) => s.seek)
  const zoom = useTimelineStore((s) => s.zoom)
  const resetZoom = useTimelineStore((s) => s.resetZoom)
  const selectMode = useTimelineStore((s) => s.selectMode)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const previousZoomRef = useRef(zoom)
  const dragRef = useRef<DragTarget | null>(null)
  /** Shift+sürükle seçiminin başladığı zaman (çıktı zamanı, sn). */
  const selectAnchorRef = useRef<number | null>(null)
  /** Sağ tık menüsü açılırken tıklanan noktanın çıktı zamanı (sn). */
  const contextTimeRef = useRef(0)

  const pct = useCallback(
    (time: number) => (duration > 0 ? clamp((time / duration) * 100, 0, 100) : 0),
    [duration],
  )

  /** Fare konumunu çıktı zamanına çevirir. */
  const timeAt = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track || duration <= 0) return 0
      const bounds = track.getBoundingClientRect()
      return clamp((clientX - bounds.left) / bounds.width, 0, 1) * duration
    },
    [duration],
  )

  /** Çıktı zamanındaki bir noktaya sar (kaynak zamanına çevirir). */
  const seekToOutput = useCallback(
    (outputTime: number) => {
      seek(outputToSourceTime(segments, clamp(outputTime, 0, duration)))
    },
    [segments, duration, seek],
  )

  const ticks = useMemo(() => {
    if (duration <= 0) return { step: 1, values: [] as number[] }
    // Yakınlaştıkça görünür aralık kısaldığı için çentik sıklığı da artar.
    const step = tickStep(duration / zoom)
    const values: number[] = []
    for (let time = 0; time <= duration; time += step) values.push(time)
    return { step, values }
  }, [duration, zoom])

  /** Kaynak zamanındaki seçimi çıktı zamanına çevir (bant gösterimi için). */
  const selectionSpan = useMemo(
    () =>
      selection
        ? {
            start: sourceToOutputTime(segments, selection.start),
            end: sourceToOutputTime(segments, selection.end),
          }
        : null,
    [selection, segments],
  )

  /** In/Out seçiminin çıktı zamanındaki yeri (işaretçiler ve bant). */
  const trimSpan = useMemo(
    () => ({
      start: sourceToOutputTime(segments, trim.start),
      end: sourceToOutputTime(segments, trim.end),
    }),
    [segments, trim.start, trim.end],
  )

  const handleTrackPointerDown = (event: React.PointerEvent) => {
    if (duration <= 0 || event.button !== 0) return
    capturePointer(event.currentTarget, event.pointerId)
    // Shift+sürükle ya da seçim modu: kesim oluşturmak için aralık seç.
    if (event.shiftKey || selectMode) {
      dragRef.current = "select"
      selectAnchorRef.current = timeAt(event.clientX)
      setSelection(null)
      return
    }
    dragRef.current = "playhead"
    seekToOutput(timeAt(event.clientX))
  }

  const handlePointerMove = (event: React.PointerEvent) => {
    const track = trackRef.current
    const wrapper = wrapperRef.current
    if (track && wrapper && duration > 0) {
      const bounds = track.getBoundingClientRect()
      const wrapperBounds = wrapper.getBoundingClientRect()
      // Balon görünür çerçeveye göre konumlanır; çizelge yatay kaydırılabilir.
      const x = clamp(event.clientX - wrapperBounds.left, 0, wrapperBounds.width)
      const half = PREVIEW_WIDTH / 2 + 4
      setHover({
        left: clamp(x, half, Math.max(half, wrapperBounds.width - half)),
        time: clamp((event.clientX - bounds.left) / bounds.width, 0, 1) * duration,
      })
    }

    const target = dragRef.current
    if (!target) return

    // Giriş/çıkış seçimi: işaretçi çizelgede nereye giderse In/Out oraya taşınır.
    if (target === "start" || target === "end") {
      const source = outputToSourceTime(segments, timeAt(event.clientX))
      if (target === "start") setTrim({ start: source })
      else setTrim({ end: source })
      return
    }

    // Shift+sürükle seçimi: bant canlı güncellenir.
    if (target === "select") {
      const anchor = selectAnchorRef.current
      if (anchor === null) return
      const other = timeAt(event.clientX)
      setSelection({
        start: outputToSourceTime(segments, Math.min(anchor, other)),
        end: outputToSourceTime(segments, Math.max(anchor, other)),
      })
      return
    }

    seekToOutput(timeAt(event.clientX))
  }

  const handlePointerUp = (event: React.PointerEvent) => {
    // Tek tık (sürüklemesiz) seçim oluşturmaz; imleci o noktaya getirir.
    if (dragRef.current === "select" && !useEditStore.getState().selection) {
      setSelection(null)
      seekToOutput(timeAt(event.clientX))
    }
    dragRef.current = null
    selectAnchorRef.current = null
    releasePointer(event.currentTarget, event.pointerId)
  }

  /** Giriş/çıkış seçimi: işaretçi çizelgede serbestçe sürüklenir (kırpma yok). */
  const beginTrimDrag = (edge: "start" | "end") => (event: React.PointerEvent) => {
    if (duration <= 0) return
    event.preventDefault()
    event.stopPropagation()
    capturePointer(trackRef.current, event.pointerId)
    dragRef.current = edge
  }

  /** Sağ tık menüsü: In/Out tıklanan noktaya taşınır (timeline kırpılmaz). */
  const setInAtPointer = () =>
    setTrim({ start: outputToSourceTime(segments, contextTimeRef.current) })
  const setOutAtPointer = () =>
    setTrim({ end: outputToSourceTime(segments, contextTimeRef.current) })

  /** Seçili aralığı keser ve imleci kesim noktasında bırakır. */
  const cutSelection = () => {
    const range = useEditStore.getState().selection
    if (!range) return
    removeSelection()
    seek(range.start)
  }

  /** Fare çizelge üzerindeyken gösterilen kare önizleme balonu. */
  const streamUrl = useSourceStore((s) => s.streamUrl)
  const [hover, setHover] = useState<{ left: number; time: number } | null>(null)
  const { meta: storyboard, failed: storyboardFailed } = useStoryboardData()

  // Kaynak değişince yeni çizelge tam görünümle açılır. İlk açılışta
  // projeden geri yüklenen yakınlaştırma korunur (StrictMode dahil).
  const initialStreamUrlRef = useRef(streamUrl)
  useEffect(() => {
    if (initialStreamUrlRef.current === streamUrl) return
    initialStreamUrlRef.current = streamUrl
    resetZoom()
  }, [streamUrl, resetZoom])

  const handlePointerLeave = () => {
    if (dragRef.current) return
    setHover(null)
  }

  /** Güncel süre: geri çağrılar yeniden kurulmadan en son değeri okur. */
  const durationRef = useRef(duration)
  useEffect(() => {
    durationRef.current = duration
  }, [duration])

  /** En güncel segmentler (imleç konumunu çıktı zamanına çevirmek için). */
  const segmentsRef = useRef(segments)
  useEffect(() => {
    segmentsRef.current = segments
  }, [segments])

  /**
   * Yatay kaydırmayı imlece göre günceller.
   * - `center`: imleci görünür alanın ortasına getirir (yakınlaştırma / yeniden yerleşim).
   * - `ensure`: imleç görünür alanın dışına çıkıyorsa içeri kaydırır (oynatma sırasında).
   * Kenarlarda `[0, maxScroll]` aralığına kırpılır; imleç görünür kalır.
   */
  const scrollToPlayhead = useCallback((mode: "center" | "ensure") => {
    const scroller = scrollRef.current
    const track = trackRef.current
    const total = durationRef.current
    if (!scroller || !track || total <= 0) return

    const viewport = scroller.clientWidth
    const maxScroll = scroller.scrollWidth - viewport
    if (viewport <= 0 || maxScroll <= 0) return

    // Çizelgenin kaydırma içeriğindeki sol kenarı (px-2 dolgusu dahil).
    const trackBounds = track.getBoundingClientRect()
    const scrollerBounds = scroller.getBoundingClientRect()
    const fraction = clamp(
      sourceToOutputTime(segmentsRef.current, usePlayerStore.getState().currentTime) / total,
      0,
      1,
    )
    const playheadX =
      trackBounds.left - scrollerBounds.left + scroller.scrollLeft + fraction * trackBounds.width

    const margin = Math.min(96, viewport * 0.18)
    let target: number | null = null

    if (mode === "center") target = playheadX - viewport / 2
    else if (playheadX < scroller.scrollLeft + margin) target = playheadX - margin
    else if (playheadX > scroller.scrollLeft + viewport - margin) {
      target = playheadX - viewport + margin
    }

    if (target === null) return
    const next = clamp(target, 0, maxScroll)
    if (Math.abs(scroller.scrollLeft - next) >= 0.5) scroller.scrollLeft = next
  }, [])

  /** Aynı karede birden fazla istek gelirse tek ölçümle ortalamayı önceliklendirir. */
  const recenterFrameRef = useRef(0)
  const recenterModeRef = useRef<"center" | "ensure">("ensure")

  const scheduleRecenter = useCallback(
    (mode: "center" | "ensure") => {
      if (mode === "center") recenterModeRef.current = "center"
      if (recenterFrameRef.current) return
      // Yeni iz genişliği yerleşmeden ölçüm yapılmamalı: bir sonraki kareyi bekle.
      recenterFrameRef.current = requestAnimationFrame(() => {
        recenterFrameRef.current = 0
        const nextMode = recenterModeRef.current
        recenterModeRef.current = "ensure"
        scrollToPlayhead(nextMode)
      })
    },
    [scrollToPlayhead],
  )

  useEffect(
    () => () => {
      if (recenterFrameRef.current) cancelAnimationFrame(recenterFrameRef.current)
      recenterFrameRef.current = 0
    },
    [],
  )

  // Yakınlaştırılan görünümde imleci görünür tut; seviye değişiminde ortala.
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return

    if (zoom <= 1) {
      previousZoomRef.current = zoom
      recenterModeRef.current = "ensure"
      if (scroller.scrollLeft !== 0) scroller.scrollLeft = 0
      return
    }

    const zoomChanged = previousZoomRef.current !== zoom
    previousZoomRef.current = zoom
    scheduleRecenter(zoomChanged ? "center" : "ensure")
  }, [currentTime, duration, zoom, scheduleRecenter])

  // Tam ekran geçişi, pencere boyutu ve şerit yerleşimi değişimlerinde yeniden ortala.
  // Tam ekranda sahne genişliği geçiş sırasında değiştiği için tek seferlik ölçüm yetersiz.
  useEffect(() => {
    if (zoom <= 1) return
    const scroller = scrollRef.current
    const track = trackRef.current
    if (!scroller || !track) return

    let lastWidths = ""
    const handleResize = () => {
      const widths = `${scroller.clientWidth}:${Math.round(track.getBoundingClientRect().width)}`
      if (widths === lastWidths) return
      lastWidths = widths
      scheduleRecenter("center")
    }
    // Tam ekran geçişi genişliği değiştirmese bile tarayıcı kaydırmayı sıfırlayabilir.
    const handleFullscreenChange = () => scheduleRecenter("center")

    const observer = new ResizeObserver(handleResize)
    observer.observe(scroller)
    observer.observe(track)
    document.addEventListener("fullscreenchange", handleFullscreenChange)

    return () => {
      observer.disconnect()
      document.removeEventListener("fullscreenchange", handleFullscreenChange)
    }
  }, [zoom, scheduleRecenter])

  /** İmlecin çıktı zamanındaki yeri (kesimler atlandığı için kaynak zamanından farklı). */
  const playheadTime = sourceToOutputTime(segments, currentTime)

  return (
    <div ref={wrapperRef} className="relative min-w-0 select-none">
      <div
        ref={scrollRef}
        onScroll={() => setHover(null)}
        className="overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-lg bg-muted/50 px-2 ring-1 ring-foreground/10 [overflow-anchor:none] [scrollbar-width:thin]"
      >
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              ref={trackRef}
              onContextMenu={(event) => {
                // Menü açılırken tıklanan noktayı çıktı zamanı olarak sakla.
                contextTimeRef.current = timeAt(event.clientX)
              }}
              onPointerDown={handleTrackPointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onPointerLeave={handlePointerLeave}
              style={{ width: `${zoom * 100}%` }}
              className={cn(
                "group/track relative h-14 touch-none",
                duration > 0 ? "cursor-crosshair" : "opacity-60",
              )}
            >
              {/* Ses dalga formu — kesimler atlanarak bitişik çizilir */}
              {duration > 0 && <WaveformLayer duration={duration} zoom={zoom} spans={spans} />}

              {/* Tampon belleği (kaynak zamanı → çıktı zamanı) */}
              <div
                className="absolute inset-y-0 left-0 bg-foreground/10"
                style={{ width: `${pct(sourceToOutputTime(segments, bufferedEnd))}%` }}
              />

              {/* In/Out seçimi: çizelgeyi kırpmaz, yalnızca clip alanını belirler */}
              {duration > 0 && (
                <div
                  aria-hidden="true"
                  data-slot="timeline-trim"
                  className="pointer-events-none absolute inset-y-0 border-x border-emerald-400/40 bg-linear-to-r from-emerald-400/10 to-amber-400/10"
                  style={{
                    left: `${pct(trimSpan.start)}%`,
                    width: `${Math.max(0, pct(trimSpan.end) - pct(trimSpan.start))}%`,
                  }}
                />
              )}

              {/* Segment birleşimleri: kesilen aralıklar atıldığı için parçalar bitişiktir */}
              {duration > 0 &&
                layout.slice(1).map((span) => (
                  <div
                    key={`join-${span.segment.id}`}
                    aria-hidden="true"
                    data-slot="timeline-join"
                    className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-foreground/25"
                    style={{ left: `${pct(span.start)}%` }}
                  />
                ))}

              {/* Kesim için seçim (Shift + sürükle) */}
              {duration > 0 && selectionSpan && (
                <div
                  data-slot="timeline-selection"
                  className="pointer-events-none absolute inset-y-0 z-10 border-x border-sky-400 bg-sky-400/25"
                  style={{
                    left: `${pct(selectionSpan.start)}%`,
                    width: `${Math.max(0, pct(selectionSpan.end) - pct(selectionSpan.start))}%`,
                  }}
                />
              )}

              {/* Çentikler ve etiketler (çıktı zamanı) */}
              {ticks.values.map((tick) => (
                <div
                  key={tick}
                  className="absolute top-0 bottom-0"
                  style={{ left: `${pct(tick)}%` }}
                >
                  <div className="absolute top-1/2 bottom-0 w-px bg-foreground/15" />
                  {tick > 0 && tick < duration && (
                    <span className="absolute bottom-0.5 -translate-x-1/2 text-[10px] whitespace-nowrap text-muted-foreground">
                      {formatTick(tick, ticks.step)}
                    </span>
                  )}
                </div>
              ))}

              {/* Giriş / Çıkış işaretçileri — seçim çizelgenin içinde serbest durur */}
              {duration > 0 && (
                <>
                  <div
                    role="slider"
                    aria-label={t("timeline.inPoint")}
                    aria-valuenow={Math.round(trim.start * 1000) / 1000}
                    data-slot="timeline-start"
                    title={t("timeline.inPointDrag")}
                    onPointerDown={beginTrimDrag("start")}
                    className="absolute inset-y-0 z-30 w-3 -translate-x-1/2 cursor-ew-resize touch-none"
                    style={{ left: `${pct(trimSpan.start)}%` }}
                  >
                    <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-emerald-400" />
                    <div className="pointer-events-none absolute top-1/2 left-1/2 h-6 w-2 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-emerald-400" />
                  </div>
                  <div
                    role="slider"
                    aria-label={t("timeline.outPoint")}
                    aria-valuenow={Math.round(trim.end * 1000) / 1000}
                    data-slot="timeline-end"
                    title={t("timeline.outPointDrag")}
                    onPointerDown={beginTrimDrag("end")}
                    className="absolute inset-y-0 z-30 w-3 -translate-x-1/2 cursor-ew-resize touch-none"
                    style={{ left: `${pct(trimSpan.end)}%` }}
                  >
                    <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-amber-400" />
                    <div className="pointer-events-none absolute top-1/2 left-1/2 h-6 w-2 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-amber-400" />
                  </div>
                </>
              )}

              {/* Oynatma imleci (çıktı zamanında; tıklama/sürükleme şeritten yapılır) */}
              {duration > 0 && (
                <div
                  aria-hidden="true"
                  data-slot="timeline-playhead"
                  className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 rounded-full bg-red-500"
                  style={{ left: `${pct(playheadTime)}%` }}
                >
                  <div className="absolute -top-0.5 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-red-500" />
                </div>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem disabled={duration <= 0} onSelect={setInAtPointer}>
              <span className="size-2 rounded-full bg-emerald-500 dark:bg-emerald-400" />
              {t("timeline.contextIn")}
            </ContextMenuItem>
            <ContextMenuItem disabled={duration <= 0} onSelect={setOutAtPointer}>
              <span className="size-2 rounded-full bg-amber-500 dark:bg-amber-400" />
              {t("timeline.contextOut")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!selection} onSelect={cutSelection}>
              <ScissorsIcon />
              {t("trim.cutSelection")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>

      {/* Kare önizleme balonu — çizelgenin üstünde görünür */}
      {hover && duration > 0 && (
        <TimelinePreview
          left={hover.left}
          time={outputToSourceTime(segments, hover.time)}
          meta={storyboard}
          failed={storyboardFailed}
        />
      )}

      {duration <= 0 && (
        <p className="mt-1.5 text-center text-xs text-muted-foreground">
          {sourceDuration <= 0
            ? isLive
              ? t("timeline.live")
              : t("timeline.loadSource")
            : t("timeline.allCut")}
        </p>
      )}
    </div>
  )
}
