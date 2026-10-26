/** Zaman çizelgesi dalga formu katmanı (nötr gri).
 *
 * Veri `WaveformProvider`'dan gelir (çıktı şeridiyle paylaşılır). Çubuklar
 * yalnızca veri/boyut değiştiğinde çizilir; oynatma sırasında yeniden çizim
 * yapılmaz.
 */
import { useEffect, useRef, useState } from "react"

import { useWaveformData } from "@/components/app/waveform-provider"
import { clamp } from "@/lib/format"
import {
  BAR_GAP,
  BAR_WIDTH,
  MAX_CANVAS_WIDTH,
  MIN_BAR_HEIGHT,
  WAVEFORM_ALPHA,
  type WaveformSpan,
  waveformColor,
} from "@/lib/waveform"

interface Size {
  width: number
  height: number
}

function drawBars(
  canvas: HTMLCanvasElement,
  buckets: Uint8Array,
  bucketSeconds: number,
  duration: number,
  loadedBuckets: number,
  color: string,
  spans?: WaveformSpan[],
) {
  const context = canvas.getContext("2d")
  if (!context || canvas.width <= 0 || canvas.height <= 0) return

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.globalAlpha = WAVEFORM_ALPHA
  context.fillStyle = color

  const total = duration > 0 ? duration : buckets.length * bucketSeconds
  const available = Math.min(buckets.length, Math.max(0, loadedBuckets))
  if (available <= 0 || total <= 0) return
  // Kova verisi kaynak zamanındadır; yüklenen süre de kaynak saniyesi olmalı.
  // (Çıktı süresiyle kıyaslanırsa ikinci parçanın kuyruğu çizilmez.)
  const loadedDuration = available * bucketSeconds
  const columns = Math.max(1, Math.floor(canvas.width / (BAR_WIDTH + BAR_GAP)))
  const center = canvas.height / 2

  /**
   * Çıktı zamanı aralığını kaynak zamanına çevirir. `spans` yoksa çizelge
   * zaten kaynak zamanındadır (kimlik dönüşümü). Kesimler atlandığı için
   * çubuklar bitişik parçalardan örneklenir.
   */
  const sourceRange = (from: number, to: number) => {
    if (!spans || spans.length === 0) return { from, to }
    const span =
      spans.find((item) => from >= item.start && from < item.end) ?? spans[spans.length - 1]
    const speed = span.speed > 0 ? span.speed : 1
    const localFrom = clamp(from - span.start, 0, span.end - span.start)
    const localTo = clamp(to - span.start, localFrom, span.end - span.start)
    return {
      from: span.sourceStart + localFrom * speed,
      to: Math.min(span.sourceEnd, span.sourceStart + localTo * speed),
    }
  }

  for (let column = 0; column < columns; column += 1) {
    const from = (column / columns) * total
    const to = ((column + 1) / columns) * total
    const range = sourceRange(from, to)
    if (range.from >= loadedDuration) continue
    const first = clamp(Math.floor(range.from / bucketSeconds), 0, available - 1)
    const last = clamp(
      Math.ceil(Math.min(range.to, loadedDuration) / bucketSeconds),
      first + 1,
      available,
    )

    let peak = 0
    for (let index = first; index < last; index += 1) {
      if (buckets[index] > peak) peak = buckets[index]
    }

    const amplitude = Math.max(MIN_BAR_HEIGHT, (peak / 255) * (center - 1))
    context.fillRect(column * (BAR_WIDTH + BAR_GAP), center - amplitude, BAR_WIDTH, amplitude * 2)
  }

  context.globalAlpha = 1
}

export function WaveformLayer({
  duration,
  zoom,
  spans,
}: {
  duration: number
  zoom: number
  /** Çıktı zamanı yerleşimi; verilirse kesilen aralıklar atlanarak çizilir. */
  spans?: WaveformSpan[]
}) {
  const data = useWaveformData()

  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  // Katmanın ölçüsü değişince (pencere/tam ekran/yakınlaştırma) çubuklar yeniden ölçeklenir.
  // zoom bağımlılığı, ResizeObserver gecikse bile yakınlaştırmada anında yeniden ölçüm sağlar.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const measure = () => setSize({ width: host.clientWidth, height: host.clientHeight })
    measure()

    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [data, zoom])

  useEffect(() => {
    const canvas = canvasRef.current
    const { width, height } = size
    if (!data || !canvas || width <= 0 || height <= 0) return

    const ratio = window.devicePixelRatio || 1
    const renderWidth = Math.min(width, MAX_CANVAS_WIDTH / ratio)
    canvas.width = Math.round(renderWidth * ratio)
    canvas.height = Math.round(height * ratio)

    drawBars(
      canvas,
      data.buckets,
      data.bucketSeconds,
      duration,
      data.loadedBuckets,
      waveformColor(hostRef.current),
      spans,
    )
  }, [data, size, duration, spans])

  if (!data) return null

  return (
    <div
      ref={hostRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden text-muted-foreground"
    >
      <canvas ref={canvasRef} data-slot="waveform-base" className="absolute inset-0 h-full w-full" />
    </div>
  )
}
