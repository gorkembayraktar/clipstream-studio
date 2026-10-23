/** Kaynağın ses dalga formunu kademeli (NDJSON) olarak getirir. */
import { useEffect, useState } from "react"

import { api } from "@/lib/api"
import { translate } from "@/i18n"
import type { WaveformStreamEvent } from "@/lib/types"
import { log } from "@/stores/log-store"
import { useSourceStore } from "@/stores/source-store"

export interface WaveformData {
  /** Kova başına tepe değeri (0–255). */
  buckets: Uint8Array
  /** Kova başına saniye. */
  bucketSeconds: number
  /** Toplam kova sayısı. */
  bucketCount: number
  /** Şu ana kadar doldurulan kova sayısı (kademeli çizim için). */
  loadedBuckets: number
  optimized: boolean
  cached: boolean
}

/** base64 → bayt dizisi (her bayt bir kova). */
function decodeBuckets(encoded: string): Uint8Array {
  const binary = window.atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/**
 * Dalga formu yardımcı bir katmandır: alınamazsa oynatma/kesim akışı bozulmaz,
 * yalnızca günlüğe uyarı düşer.
 *
 * `audioUrl` dolu ise (video akışı sessiz — ör. YouTube HLS) ses doğrudan
 * o akıştan çıkarılır.
 */
export function useWaveform(
  url: string | null,
  origin: string | null,
  duration: number,
  audioUrl: string | null = null,
  hasAudio: boolean | null = null,
  audioTrackId: string | null = null,
) {
  // Sessiz olduğu bilinen ve ayrı ses akışı olmayan kaynakta hiç istek atılmaz.
  const enabled =
    Boolean(url) && duration > 0 && !(hasAudio === false && !audioUrl)
  const headers = useSourceStore((s) => s.headers)
  const headersKey = JSON.stringify(headers ?? {})

  const [data, setData] = useState<WaveformData | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!enabled || !url) {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    let cancelled = false
    setData(null)
    setLoading(true)
    setError(null)

    const started = performance.now()
    log("info", translate("log.waveformPreparing"), audioUrl ?? url)

    void (async () => {
      try {
        const response = await api.waveformStream(
          {
            url,
            origin: origin || undefined,
            duration,
            audio_url: audioUrl ?? undefined,
            audio_track: audioTrackId ?? undefined,
            headers: headers ?? undefined,
          },
          controller.signal,
        )
        const body = response.body
        if (!body) throw new Error(translate("log.waveformFailed"))

        const reader = body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        let buckets: Uint8Array | null = null
        let bucketSeconds = 0.25
        let bucketCount = 0
        let loadedBuckets = 0
        let optimized = false
        let cached = false

        const publish = () => {
          if (!buckets || cancelled) return
          setData({
            buckets,
            bucketSeconds,
            bucketCount: buckets.length,
            loadedBuckets,
            optimized,
            cached,
          })
        }

        const apply = (event: WaveformStreamEvent) => {
          if (event.type === "start") {
            optimized = Boolean(event.optimized)
            cached = Boolean(event.cached)
            bucketSeconds = event.bucket_seconds || 0.25
            bucketCount = event.bucket_count || 0
            loadedBuckets = 0
            buckets = event.silent ? null : new Uint8Array(bucketCount)
            if (buckets) publish()
            return
          }

          if (event.type === "chunk") {
            if (!buckets) {
              // Beklenmedik sıra: yine de veriyi kaybetme.
              bucketCount = Math.max(bucketCount, event.start + event.count)
              buckets = new Uint8Array(bucketCount)
            }
            const bytes = decodeBuckets(event.buckets)
            const target = buckets
            const available = Math.max(0, target.length - event.start)
            // Parçalar kova sınırında birkaç bayt örtüşebilir; düşük tepe
            // değerinin önceki parçanın tepesini ezmemesi için max uygula.
            const count = Math.min(bytes.length, available)
            for (let index = 0; index < count; index += 1) {
              const bucketIndex = event.start + index
              if (bytes[index] > target[bucketIndex]) {
                target[bucketIndex] = bytes[index]
              }
            }
            loadedBuckets = Math.max(
              loadedBuckets,
              Math.min(target.length, event.start + bytes.length),
            )
            publish()
            return
          }

          if (event.type === "error") {
            throw new Error(event.error)
          }

          // done
          bucketSeconds = event.bucket_seconds || bucketSeconds
          bucketCount = event.bucket_count || bucketCount
          optimized = Boolean(event.optimized)
          cached = Boolean(event.cached)
          if (event.silent) {
            setData(null)
            log("info", translate("log.waveformSilent"))
          } else {
            loadedBuckets = Math.max(loadedBuckets, bucketCount)
            publish()
            const elapsed = Math.round(performance.now() - started)
            if (cached) {
              log("info", translate("log.waveformCached", { ms: elapsed }))
            } else {
              const note = optimized ? translate("log.waveformOptimized") : ""
              log(
                "success",
                translate("log.waveformReady", {
                  count: bucketCount,
                  seconds: bucketSeconds,
                  ms: elapsed,
                  note,
                }),
              )
            }
          }
          setLoading(false)
        }

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          let newline = buffer.indexOf("\n")
          while (newline >= 0) {
            const line = buffer.slice(0, newline).trim()
            buffer = buffer.slice(newline + 1)
            if (line) apply(JSON.parse(line) as WaveformStreamEvent)
            newline = buffer.indexOf("\n")
          }
        }

        buffer += decoder.decode()
        if (buffer.trim()) {
          apply(JSON.parse(buffer.trim()) as WaveformStreamEvent)
        }
        if (!cancelled) setLoading(false)
      } catch (err) {
        if (
          cancelled ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return
        }
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)))
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
    // `headersKey`, headers nesnesinin içeriğini temsil eder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, origin, duration, audioUrl, audioTrackId, headersKey, enabled])

  useEffect(() => {
    if (!error) return
    log(
      "warn",
      translate("log.waveformFailed"),
      error instanceof Error ? error.message : undefined,
    )
  }, [error])

  return { data, loading, error }
}
