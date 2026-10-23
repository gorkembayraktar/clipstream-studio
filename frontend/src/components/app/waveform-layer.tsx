/** Zaman çizelgesi dalga formu katmanı (nötr gri).
 *
 * Çubuklar yalnızca veri/boyut değiştiğinde çizilir; oynatma sırasında
 * yeniden çizim yapılmaz.
 */
import { useEffect, useRef, useState } from "react"

import { useWaveform } from "@/hooks/use-waveform"
import { clamp } from "@/lib/format"
import { useSourceStore } from "@/stores/source-store"

/** Çubuk genişliği ve komşusuyla arası (px). */
const BAR_WIDTH = 2
const BAR_GAP = 1
/** Çubukların en küçük yüksekliği (sessiz bölümler de görünür kalsın). */
const MIN_BAR_HEIGHT = 1
/** Sabit gri (muted-foreground okunamazsa yedek). */
const FALLBACK_GRAY = "#a1a1aa"

interface Size {
  width: number
  height: number
}

/** Canvas'ın anlayacağı bir renk mi? (color-mix gibi değerler çizilemez) */
function isDrawableColor(value: string): boolean {
  return /^(#|rgb|hsl|oklch|lab|lch|color\()/i.test(value.trim())
}

function drawBars(
  canvas: HTMLCanvasElement,
  buckets: Uint8Array,
  bucketSeconds: number,
  duration: number,
  loadedBuckets: number,
  color: string,
) {
  const context = canvas.getContext("2d")
  if (!context || canvas.width <= 0 || canvas.height <= 0) return

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.globalAlpha = 0.9
  context.fillStyle = color

  const total = duration > 0 ? duration : buckets.length * bucketSeconds
  const available = Math.min(buckets.length, Math.max(0, loadedBuckets))
  if (available <= 0 || total <= 0) return
  const loadedDuration = Math.min(total, available * bucketSeconds)
  const columns = Math.max(1, Math.floor(canvas.width / (BAR_WIDTH + BAR_GAP)))
  const center = canvas.height / 2

  for (let column = 0; column < columns; column += 1) {
    const from = (column / columns) * total
    if (from >= loadedDuration) continue
    const to = Math.min(((column + 1) / columns) * total, loadedDuration)
    const first = clamp(Math.floor(from / bucketSeconds), 0, available - 1)
    const last = clamp(Math.ceil(to / bucketSeconds), first + 1, available)

    let peak = 0
    for (let index = first; index < last; index += 1) {
      if (buckets[index] > peak) peak = buckets[index]
    }

    const amplitude = Math.max(MIN_BAR_HEIGHT, (peak / 255) * (center - 1))
    context.fillRect(column * (BAR_WIDTH + BAR_GAP), center - amplitude, BAR_WIDTH, amplitude * 2)
  }

  context.globalAlpha = 1
}

export function WaveformLayer({ duration }: { duration: number }) {
  const streamUrl = useSourceStore((s) => s.streamUrl)
  const origin = useSourceStore((s) => s.sourceOrigin)
  const audioUrl = useSourceStore((s) => s.audioUrl)
  const audioTrackId = useSourceStore((s) => s.audioTrackId)
  const hasAudio = useSourceStore((s) => s.meta?.hasAudio)
  const waveformAudioUrl =
    audioTrackId || hasAudio === false ? audioUrl : null
  const { data } = useWaveform(
    streamUrl,
    origin,
    duration,
    waveformAudioUrl,
    hasAudio ?? null,
    audioTrackId,
  )

  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  // Katmanın ölçüsü değişince (pencere/tam ekran) çubuklar yeniden ölçeklenir
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const measure = () => setSize({ width: host.clientWidth, height: host.clientHeight })
    measure()

    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [data])

  useEffect(() => {
    const canvas = canvasRef.current
    const { width, height } = size
    if (!data || !canvas || width <= 0 || height <= 0) return

    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)

    const computed = hostRef.current ? getComputedStyle(hostRef.current).color : ""
    drawBars(
      canvas,
      data.buckets,
      data.bucketSeconds,
      duration,
      data.loadedBuckets,
      isDrawableColor(computed) ? computed : FALLBACK_GRAY,
    )
  }, [data, size, duration])

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
