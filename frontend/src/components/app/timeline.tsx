/** İnteraktif zaman çizelgesi: kesimler birleşik (çıktı zamanı) + oynatma imleci + kare önizleme.
 *
 * Segmentler kaynak zamanında tutulur; burada aralarındaki boşluklar
 * atlanarak bitişik gösterilir. Süre, çentikler ve imleç çıktı zamanındadır.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  ChevronRightIcon,
  DownloadIcon,
  EraserIcon,
  ScissorsIcon,
  Trash2Icon,
} from "lucide-react"

import { cn } from "cn"

import { PROFILE_LABEL_KEYS } from "@/components/app/export-panel-constants"
import { useStoryboardData } from "@/components/app/storyboard-provider"
import { PREVIEW_WIDTH, TimelinePreview } from "@/components/app/timeline-preview"
import { WaveformLayer } from "@/components/app/waveform-layer"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { useQuickExport, QUICK_EXPORT_PROFILES } from "@/hooks/use-quick-export"
import { useSourceDuration } from "@/hooks/use-source-duration"
import { useI18n } from "@/i18n"
import { clamp, formatTick, tickStep } from "@/lib/format"
import {
  createSegment,
  layoutOf,
  outputDuration,
  outputToSourceTime,
  pieceAt,
  segmentAt,
  sourceToOutputTime,
  useEditStore,
} from "@/stores/edit-store"
import { usePlayerStore } from "@/stores/player-store"
import { useSourceStore } from "@/stores/source-store"
import { useStreamStore } from "@/stores/stream-store"
import { useTimelineStore } from "@/stores/timeline-store"

type DragTarget = "playhead" | "select" | "start" | "end"

/** Zaman çizelgesindeki akış bloğu (bir kaydın ard arda segmentleri). */
interface TimelineBlock {
  id: string
  name: string
  start: number
  end: number
  recordingId: string
}

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
  const splits = useEditStore((s) => s.splits)
  const selection = useEditStore((s) => s.selection)
  const setSelection = useEditStore((s) => s.setSelection)
  const removeSelection = useEditStore((s) => s.removeSelection)
  const isLive = useSourceStore((s) => s.isLive)
  const playerLive = usePlayerStore((s) => s.live)
  const liveEdge = usePlayerStore((s) => s.liveEdge)
  const sourceDuration = useSourceDuration()

  // Canlı yayında düzenlenebilir segment yoktur: çizelge, oynatıcının bildirdiği
  // canlı pencereyle [0, canlı uç] çizilir. Kayıt şeridi bu pencerede büyür;
  // VOD kaynaklarında (segmentler dolu) bu yol hiç devreye girmez.
  const liveMode =
    (isLive || playerLive) && liveEdge > 0 && outputDuration(segments) <= 0
  const view = useMemo(
    () => (liveMode ? [createSegment(0, liveEdge)] : segments),
    [liveEdge, liveMode, segments],
  )

  /** Kesimler birleştirildiği için çizelge çıktı zamanındadır. */
  const layout = useMemo(() => layoutOf(view), [view])
  const duration = useMemo(() => outputDuration(view), [view])
  /**
   * Makasla konan bölme noktaları (çıktı zamanında).
   *
   * Yalnızca korunan bir parçanın içinde kalanlar çizilir; kesilmiş aralığa
   * düşen bir nokta görünmez.
   */
  const splitMarkers = useMemo(
    () =>
      splits
        .filter((point) => segmentAt(view, point))
        .map((point) => sourceToOutputTime(view, point)),
    [splits, view],
  )
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
  const quickExport = useQuickExport()

  const wrapperRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const previousZoomRef = useRef(zoom)
  const dragRef = useRef<DragTarget | null>(null)
  /** Shift+sürükle seçiminin başladığı zaman (çıktı zamanı, sn). */
  const selectAnchorRef = useRef<number | null>(null)
  /** Sağ tık menüsü açılırken tıklanan noktanın çıktı zamanı (sn). */
  const contextTimeRef = useRef(0)
  /** Sağ tık menüsü hangi akış bloğunda açıldı (yoksa null). */
  const [contextBlock, setContextBlock] = useState<TimelineBlock | null>(null)

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
      seek(outputToSourceTime(view, clamp(outputTime, 0, duration)))
    },
    [view, duration, seek],
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
            start: sourceToOutputTime(view, selection.start),
            end: sourceToOutputTime(view, selection.end),
          }
        : null,
    [selection, view],
  )

  /** In/Out seçiminin çıktı zamanındaki yeri (işaretçiler ve bant). */
  const trimSpan = useMemo(
    () => ({
      start: sourceToOutputTime(view, trim.start),
      end: sourceToOutputTime(view, trim.end),
    }),
    [view, trim.start, trim.end],
  )

  const handleTrackPointerDown = (event: React.PointerEvent) => {
    if (duration <= 0 || event.button !== 0) return
    capturePointer(event.currentTarget, event.pointerId)
    // Shift+sürükle ya da seçim modu: kesim oluşturmak için aralık seç.
    // Canlı yayında kesim yoktur; her tıklama imleci taşır.
    if (!liveMode && (event.shiftKey || selectMode)) {
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
      const source = outputToSourceTime(view, timeAt(event.clientX))
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
        start: outputToSourceTime(view, Math.min(anchor, other)),
        end: outputToSourceTime(view, Math.max(anchor, other)),
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
    // Canlı yayında In/Out yoktur: kaynak henüz bitmemiştir.
    if (duration <= 0 || liveMode) return
    event.preventDefault()
    event.stopPropagation()
    capturePointer(trackRef.current, event.pointerId)
    dragRef.current = edge
  }

  /** Sağ tık menüsü: In/Out tıklanan noktaya taşınır (timeline kırpılmaz). */
  const setInAtPointer = () =>
    setTrim({ start: outputToSourceTime(view, contextTimeRef.current) })
  const setOutAtPointer = () =>
    setTrim({ end: outputToSourceTime(view, contextTimeRef.current) })

  /** Seçili aralığı keser ve imleci kesim noktasında bırakır. */
  const cutSelection = () => {
    const range = useEditStore.getState().selection
    if (!range) return
    removeSelection()
    seek(range.start)
  }

  /** Tıklanan noktadan böler (makas): içerik atılmaz, parça ikiye ayrılır. */
  const splitAtPointer = () => {
    const at = outputToSourceTime(view, contextTimeRef.current)
    useEditStore.getState().splitAt(at)
  }

  /** Tıklanan noktadaki parçayı siler (boşluk bırakır, geri alınabilir). */
  const deletePieceAtPointer = () => {
    const at = outputToSourceTime(view, contextTimeRef.current)
    const piece = pieceAt(
      useEditStore.getState().segments,
      useEditStore.getState().splits,
      at,
    )
    if (!piece) return
    if (useEditStore.getState().removePieceAt(at)) seek(piece.start)
  }

  /** Fare çizelge üzerindeyken gösterilen kare önizleme balonu. */
  const streamUrl = useSourceStore((s) => s.streamUrl)
  const streamId = useSourceStore((s) => s.streamId)
  const blocks = useStreamStore((s) => s.summary?.blocks)
  const removeRecording = useStreamStore((s) => s.removeRecording)
  /** Silinmesi onaylanan blok (kayıt). */
  const [pendingDelete, setPendingDelete] = useState<TimelineBlock | null>(null)
  const [hover, setHover] = useState<{ left: number; time: number } | null>(null)
  const { meta: storyboard, failed: storyboardFailed } = useStoryboardData()

  /**
   * Akış blokları: her kayıt zaman çizelgesinde ard arda bir bloktur.
   *
   * Blok sınırları akışın kendi zamanındadır; kesimler varsa çıktı zamanına
   * çevrilerek çizilir. Yalnızca akış kaynağı açıkken gösterilir (canlı yayın
   * penceresinde yanıltıcı olmasın).
   */
  const blockSpans = useMemo<TimelineBlock[]>(() => {
    if (!streamId || liveMode || !blocks || blocks.length === 0) return []
    return blocks
      .filter((block) => block.end > block.start)
      .map((block) => ({
        id: block.recording_id,
        name: block.title,
        start: block.start,
        end: block.end,
        recordingId: block.recording_id,
      }))
  }, [blocks, liveMode, streamId])

  // Kaynak değişince yeni çizelge tam görünümle açılır. İlk açılışta
  // projeden geri yüklenen yakınlaştırma korunur (StrictMode dahil).
  // Akışa yeni kayıt eklemek oynatma adresini tazeler (sürüm sorgusu); aynı
  // akışta yakınlaştırma korunur (yalnızca yeni akış/kaynakta sıfırlanır).
  const initialStreamUrlRef = useRef(streamUrl)
  const initialStreamIdRef = useRef(streamId)
  useEffect(() => {
    if (streamId) {
      if (initialStreamIdRef.current === streamId) return
      initialStreamIdRef.current = streamId
      initialStreamUrlRef.current = streamUrl
      resetZoom()
      return
    }
    initialStreamIdRef.current = null
    if (initialStreamUrlRef.current === streamUrl) return
    initialStreamUrlRef.current = streamUrl
    resetZoom()
  }, [streamUrl, streamId, resetZoom])

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
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  }, [view])

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
      sourceToOutputTime(viewRef.current, usePlayerStore.getState().currentTime) / total,
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
  const playheadTime = sourceToOutputTime(view, currentTime)

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
                // Canlı yayında kesim/kırpma yok: menü açılmaz.
                if (liveMode) {
                  event.preventDefault()
                  return
                }
                // Menü açılırken tıklanan noktayı çıktı zamanı olarak sakla.
                contextTimeRef.current = timeAt(event.clientX)
                // Bloğun üzerinde miyiz? "Bu kaydı sil" yalnızca o zaman çıkar.
                const sourceTime = outputToSourceTime(view, contextTimeRef.current)
                setContextBlock(
                  blockSpans.find(
                    (block) =>
                      sourceTime >= block.start && sourceTime < block.end,
                  ) ?? null,
                )
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
              {/* Ses dalga formu — kesimler atlanarak bitişik çizilir.
                  Canlı yayında dalga formu çıkarılmaz (kaynak henüz bitmedi). */}
              {!liveMode && duration > 0 && (
                <WaveformLayer duration={duration} zoom={zoom} spans={spans} />
              )}

              {/* Tampon belleği (kaynak zamanı → çıktı zamanı) */}
              <div
                className="absolute inset-y-0 left-0 bg-foreground/10"
                style={{ width: `${pct(sourceToOutputTime(view, bufferedEnd))}%` }}
              />

              {/* In/Out seçimi: çizelgeyi kırpmaz, yalnızca clip alanını belirler */}
              {!liveMode && duration > 0 && (
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

              {/* Proje akışı: her kayıt ard arda bir blok (sınır + ad) */}
              {duration > 0 &&
                blockSpans.map((block, index) => {
                  const start = sourceToOutputTime(view, block.start)
                  const end = sourceToOutputTime(view, block.end)
                  if (index > 0 && end - start < 0.001) return null
                  return (
                    <div
                      key={`block-${block.id}`}
                      aria-hidden="true"
                      data-slot="timeline-clip"
                      className={cn(
                        "pointer-events-none absolute inset-y-0",
                        index % 2 === 1 && "bg-foreground/[0.045]",
                      )}
                      style={{
                        left: `${pct(start)}%`,
                        width: `${Math.max(0, pct(end) - pct(start))}%`,
                      }}
                    >
                      {blockSpans.length > 1 ? (
                        <span className="absolute top-0.5 left-1 max-w-[calc(100%-0.5rem)] truncate rounded-sm bg-background/70 px-1 text-[9px] leading-4 text-muted-foreground">
                          {block.name}
                        </span>
                      ) : null}
                    </div>
                  )
                })}
              {duration > 0 &&
                blockSpans.slice(1).map((block) => (
                  <div
                    key={`block-edge-${block.id}`}
                    aria-hidden="true"
                    data-slot="timeline-clip-edge"
                    className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-sky-400/70"
                    style={{ left: `${pct(sourceToOutputTime(view, block.start))}%` }}
                  />
                ))}

              {/* Makas izleri: imleçten bölünen noktalar (içerik atılmaz) */}
              {duration > 0 &&
                splitMarkers.map((marker) => (
                  <div
                    key={`split-${marker}`}
                    aria-hidden="true"
                    data-slot="timeline-split"
                    className="pointer-events-none absolute inset-y-0 z-20 -translate-x-1/2 border-l-2 border-dashed border-amber-400/80"
                    style={{ left: `${pct(marker)}%` }}
                  />
                ))}

              {/* Kesim için seçim (Shift + sürükle) */}
              {!liveMode && duration > 0 && selectionSpan && (
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
              {!liveMode && duration > 0 && (
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
            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={!quickExport.canExport}>
                <DownloadIcon />
                {t("timeline.exportMenu")}
                <ChevronRightIcon className="ml-auto" />
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="min-w-[10rem]">
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    MP4
                    <ChevronRightIcon className="ml-auto" />
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent>
                    {QUICK_EXPORT_PROFILES.map((profile) => (
                      <ContextMenuItem
                        key={profile}
                        disabled={
                          profile === "original" && !quickExport.originalAvailable
                        }
                        onSelect={() => quickExport.run("mp4", profile)}
                      >
                        {t(PROFILE_LABEL_KEYS[profile])}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuItem
                  disabled={quickExport.multiSegment}
                  onSelect={() => quickExport.run("gif")}
                >
                  GIF
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={quickExport.multiSegment}
                  onSelect={() => quickExport.run("mp3")}
                >
                  MP3
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={splitAtPointer}>
              <ScissorsIcon />
              {t("timeline.splitHere")}
            </ContextMenuItem>
            <ContextMenuItem
              disabled={splits.length === 0}
              onSelect={deletePieceAtPointer}
            >
              <Trash2Icon />
              {t("timeline.deletePiece")}
            </ContextMenuItem>
            <ContextMenuItem disabled={!selection} onSelect={cutSelection}>
              <EraserIcon />
              {t("trim.removeSelection")}
            </ContextMenuItem>
            {contextBlock ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  variant="destructive"
                  onSelect={() => {
                    // Menü açıkken akış özeti değişmiş olabilir (başka sekmede
                    // kayıt bitti/silindi): hedefi seçim anında yeniden doğrula.
                    const at = outputToSourceTime(view, contextTimeRef.current)
                    const block =
                      blockSpans.find(
                        (item) => at >= item.start && at < item.end,
                      ) ?? contextBlock
                    if (block) setPendingDelete(block)
                  }}
                >
                  <Trash2Icon />
                  {t("timeline.deleteBlock")}
                </ContextMenuItem>
              </>
            ) : null}
          </ContextMenuContent>
        </ContextMenu>
      </div>

      {/* Kayıt silme: blok akıştan (dosyalarıyla) çıkarılır, geri alınamaz. */}
      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("timeline.deleteBlockTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("timeline.deleteBlockDesc", {
                name: pendingDelete?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("timeline.deleteBlockCancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const block = pendingDelete
                setPendingDelete(null)
                if (block) void removeRecording(block.recordingId)
              }}
            >
              {t("timeline.deleteBlockConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
