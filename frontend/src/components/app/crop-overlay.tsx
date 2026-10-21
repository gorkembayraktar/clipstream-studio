/** Video üzerinde sürüklenip boyutlandırılabilir kırpma seçim kutusu.
 *
 * Seçim dikdörtgeni her zaman *video piksel uzayında* tutulur (ffmpeg crop=w:h:x:y
 * ile birebir uyumlu). Görüntüleme, video elementinin letterbox ölçüsü üzerinden
 * ölçeklenir; bu sayede pencere boyutu değişse bile koordinatlar tutarlı kalır.
 */
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react"

import { cn } from "cn"

import { clamp } from "@/lib/format"
import type { CropRect } from "@/lib/types"
import { useEditStore } from "@/stores/edit-store"

type HandleDir = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"

const MIN_SIZE = 24
const CORNERS: HandleDir[] = ["nw", "ne", "se", "sw"]
const EDGES: HandleDir[] = ["n", "e", "s", "w"]

const HANDLE_CLASSES: Record<HandleDir, string> = {
  nw: "-top-1.5 -left-1.5 cursor-nwse-resize",
  n: "-top-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize",
  ne: "-top-1.5 -right-1.5 cursor-nesw-resize",
  e: "-right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize",
  se: "-bottom-1.5 -right-1.5 cursor-nwse-resize",
  s: "-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize",
  sw: "-bottom-1.5 -left-1.5 cursor-nesw-resize",
  w: "-left-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize",
}

interface Measurement {
  scale: number
  offsetX: number
  offsetY: number
  videoWidth: number
  videoHeight: number
}

interface DragState {
  kind: "move" | "resize"
  dir?: HandleDir
  startClientX: number
  startClientY: number
  startRect: CropRect
}

function aspectValue(aspect: string): number | null {
  if (aspect === "free") return null
  const [width, height] = aspect.split(":").map(Number)
  return width && height ? width / height : null
}

function roundRect(rect: CropRect): CropRect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(2, Math.round(rect.width)),
    height: Math.max(2, Math.round(rect.height)),
  }
}

function moveRect(rect: CropRect, dx: number, dy: number, vw: number, vh: number): CropRect {
  return roundRect({
    ...rect,
    x: clamp(rect.x + dx, 0, Math.max(0, vw - rect.width)),
    y: clamp(rect.y + dy, 0, Math.max(0, vh - rect.height)),
  })
}

function resizeRect(
  start: CropRect,
  dir: HandleDir,
  dx: number,
  dy: number,
  ratio: number | null,
  vw: number,
  vh: number,
): CropRect {
  const hasEast = dir.includes("e")
  const hasWest = dir.includes("w")
  const hasSouth = dir.includes("s")
  const hasNorth = dir.includes("n")

  if (ratio) {
    // Oran kilitli: yalnızca köşe tutamaçları, karşı kenar sabit
    let width = hasEast ? start.width + dx : start.width - dx
    const maxWidth = hasEast ? vw - start.x : start.x + start.width
    width = clamp(width, MIN_SIZE, Math.max(MIN_SIZE, maxWidth))

    let height = width / ratio
    const maxHeight = hasSouth ? vh - start.y : start.y + start.height
    if (height > maxHeight) {
      height = maxHeight
      width = height * ratio
    }
    if (height < MIN_SIZE) {
      height = MIN_SIZE
      width = height * ratio
    }
    if (width < MIN_SIZE) {
      width = MIN_SIZE
      height = width / ratio
    }

    const x = hasEast ? start.x : start.x + start.width - width
    const y = hasSouth ? start.y : start.y + start.height - height
    return roundRect({ x, y, width, height })
  }

  let { x, y, width, height } = start
  if (hasEast) width = clamp(start.width + dx, MIN_SIZE, Math.max(MIN_SIZE, vw - start.x))
  if (hasWest) {
    const right = start.x + start.width
    x = clamp(start.x + dx, 0, Math.max(0, right - MIN_SIZE))
    width = right - x
  }
  if (hasSouth) height = clamp(start.height + dy, MIN_SIZE, Math.max(MIN_SIZE, vh - start.y))
  if (hasNorth) {
    const bottom = start.y + start.height
    y = clamp(start.y + dy, 0, Math.max(0, bottom - MIN_SIZE))
    height = bottom - y
  }
  return roundRect({ x, y, width, height })
}

export function CropOverlay({ videoRef }: { videoRef: RefObject<HTMLVideoElement | null> }) {
  const crop = useEditStore((s) => s.crop)
  const setCropRect = useEditStore((s) => s.setCropRect)

  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [measure, setMeasure] = useState<Measurement | null>(null)

  // ---- Ölçüm: video elementinin letterbox'lı görüntü alanını hesapla ----
  useEffect(() => {
    const el = videoRef.current
    const container = containerRef.current
    if (!el || !container) return

    const update = () => {
      const videoWidth = el.videoWidth
      const videoHeight = el.videoHeight
      if (!videoWidth || !videoHeight) return

      const videoRect = el.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      if (videoRect.width <= 0 || videoRect.height <= 0) return

      const scale = Math.min(videoRect.width / videoWidth, videoRect.height / videoHeight)
      const contentWidth = videoWidth * scale
      const contentHeight = videoHeight * scale
      const offsetX = videoRect.left - containerRect.left + (videoRect.width - contentWidth) / 2
      const offsetY = videoRect.top - containerRect.top + (videoRect.height - contentHeight) / 2

      setMeasure((previous) => {
        if (
          previous &&
          previous.scale === scale &&
          previous.offsetX === offsetX &&
          previous.offsetY === offsetY &&
          previous.videoWidth === videoWidth &&
          previous.videoHeight === videoHeight
        ) {
          return previous
        }
        return { scale, offsetX, offsetY, videoWidth, videoHeight }
      })
    }

    update()
    el.addEventListener("loadedmetadata", update)
    const observer = new ResizeObserver(update)
    observer.observe(container)
    observer.observe(el)
    window.addEventListener("resize", update)
    return () => {
      el.removeEventListener("loadedmetadata", update)
      observer.disconnect()
      window.removeEventListener("resize", update)
    }
  }, [videoRef])

  // ---- Başlangıç: kırpma açıkken ve seçim yokken tam kareyi yerleştir ----
  useEffect(() => {
    if (!crop.enabled || !measure || crop.rect) return
    setCropRect({
      x: 0,
      y: 0,
      width: measure.videoWidth,
      height: measure.videoHeight,
    })
  }, [crop.enabled, crop.rect, measure, setCropRect])

  // ---- Oran değişince mevcut seçimi yeni orana oturt ----
  const previousAspect = useRef(crop.aspect)
  useEffect(() => {
    if (!measure) return
    if (previousAspect.current === crop.aspect) return
    previousAspect.current = crop.aspect

    const ratio = aspectValue(crop.aspect)
    const current = useEditStore.getState().crop.rect
    if (!ratio || !current) return

    const { videoWidth: vw, videoHeight: vh } = measure
    const centerX = current.x + current.width / 2
    const centerY = current.y + current.height / 2

    let width = Math.min(current.width, vw)
    let height = width / ratio
    if (height > vh) {
      height = vh
      width = height * ratio
    }

    const x = clamp(centerX - width / 2, 0, Math.max(0, vw - width))
    const y = clamp(centerY - height / 2, 0, Math.max(0, vh - height))
    setCropRect(roundRect({ x, y, width, height }))
  }, [crop.aspect, measure, setCropRect])

  // ---- Sürükleme ----
  const beginDrag = (
    event: ReactPointerEvent,
    kind: DragState["kind"],
    dir?: HandleDir,
  ) => {
    if (!crop.rect) return
    event.preventDefault()
    event.stopPropagation()
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    dragRef.current = {
      kind,
      dir,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: crop.rect,
    }
  }

  const onPointerMove = (event: ReactPointerEvent) => {
    const drag = dragRef.current
    if (!drag || !measure) return

    const dx = (event.clientX - drag.startClientX) / measure.scale
    const dy = (event.clientY - drag.startClientY) / measure.scale

    const next =
      drag.kind === "move"
        ? moveRect(drag.startRect, dx, dy, measure.videoWidth, measure.videoHeight)
        : resizeRect(
            drag.startRect,
            drag.dir as HandleDir,
            dx,
            dy,
            aspectValue(crop.aspect),
            measure.videoWidth,
            measure.videoHeight,
          )

    setCropRect(next)
  }

  const endDrag = (event: ReactPointerEvent) => {
    dragRef.current = null
    const target = event.currentTarget as HTMLElement
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId)
    }
  }

  const handles = aspectValue(crop.aspect) ? CORNERS : [...CORNERS, ...EDGES]

  // Kapsayıcı div her zaman render edilir: ölçüm effect'i bu elemana ihtiyaç duyar
  // (aksi halde ölçüm hiç yapılamaz ve seçim kutusu asla görünmez).
  const view =
    measure && crop.rect
      ? {
          rect: crop.rect,
          left: measure.offsetX + crop.rect.x * measure.scale,
          top: measure.offsetY + crop.rect.y * measure.scale,
          width: crop.rect.width * measure.scale,
          height: crop.rect.height * measure.scale,
        }
      : null

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-10 select-none">
      {view && (
        <>
          {/* Seçim dışını yalnızca sahne alanında karart; taşan gölge kontrol
              şeridinin (zaman çizelgesi vb.) üzerini kapatmasın. */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div
              className="absolute"
              style={{
                left: 0,
                top: 0,
                right: 0,
                height: view.top,
                backgroundColor: "rgb(0 0 0 / 0.55)",
              }}
            />
            <div
              className="absolute"
              style={{
                left: 0,
                top: view.top + view.height,
                right: 0,
                bottom: 0,
                backgroundColor: "rgb(0 0 0 / 0.55)",
              }}
            />
            <div
              className="absolute"
              style={{
                left: 0,
                top: view.top,
                width: view.left,
                height: view.height,
                backgroundColor: "rgb(0 0 0 / 0.55)",
              }}
            />
            <div
              className="absolute"
              style={{
                left: view.left + view.width,
                top: view.top,
                right: 0,
                height: view.height,
                backgroundColor: "rgb(0 0 0 / 0.55)",
              }}
            />
          </div>
          <div
            className="pointer-events-auto absolute cursor-move touch-none border border-white/90"
            style={{
              left: view.left,
              top: view.top,
              width: view.width,
              height: view.height,
            }}
            onPointerDown={(event) => beginDrag(event, "move")}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {/* Üçler kuralı kılavuzları */}
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-y-0 left-1/3 w-px bg-white/25" />
              <div className="absolute inset-y-0 left-2/3 w-px bg-white/25" />
              <div className="absolute inset-x-0 top-1/3 h-px bg-white/25" />
              <div className="absolute inset-x-0 top-2/3 h-px bg-white/25" />
            </div>

            {handles.map((dir) => (
              <div
                key={dir}
                onPointerDown={(event) => beginDrag(event, "resize", dir)}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                className={cn(
                  "absolute size-3 rounded-[3px] border border-white bg-black/60",
                  HANDLE_CLASSES[dir],
                )}
              />
            ))}

            <span className="pointer-events-none absolute right-1 bottom-1 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white/90">
              {view.rect.width}×{view.rect.height}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
