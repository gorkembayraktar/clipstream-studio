/** Kaynağın ses dalga formunu (sunucuda önbelleklenmiş) getirir. */
import { useEffect } from "react"

import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api"
import { log } from "@/stores/log-store"
import { useStudioStore } from "@/stores/studio-store"

export interface WaveformData {
  /** Kova başına tepe değeri (0–255). */
  buckets: Uint8Array
  /** Kova başına saniye. */
  bucketSeconds: number
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

export const waveformKeys = {
  source: (
    url: string,
    origin: string,
    audioUrl: string,
    headers: Record<string, string> | null,
  ) => ["waveform", url, origin, audioUrl, headers] as const,
}

/**
 * Dalga formu yardımcı bir katmandır: alınamazsa oynatma/kesim akışı bozulmaz,
 * yalnızca günlüğe uyarı düşer.
 *
 * `audioUrl` dolu ise (video akışı sessiz — ör. YouTube HLS) ses doğrudan o
 * akıştan çıkarılır.
 */
export function useWaveform(
  url: string | null,
  origin: string,
  duration: number,
  audioUrl: string | null = null,
  hasAudio: boolean | null = null,
) {
  // Sessiz olduğu bilinen ve ayrı ses akışı olmayan kaynakta hiç istek atılmaz.
  const enabled =
    Boolean(url) && duration > 0 && !(hasAudio === false && !audioUrl)
  const headers = useStudioStore((s) => s.headers)

  const query = useQuery({
    queryKey: waveformKeys.source(url ?? "", origin, audioUrl ?? "", headers),
    enabled,
    // Aynı kaynak için istemci tarafında tekrar istek atılmaz (sunucuda da önbellek var).
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 0,
    queryFn: async (): Promise<WaveformData> => {
      const started = performance.now()
      log("info", "Dalga formu hazırlanıyor...", audioUrl ?? url ?? undefined)

      const response = await api.waveform({
        url: url as string,
        origin: origin || undefined,
        duration,
        audio_url: audioUrl ?? undefined,
        headers: headers ?? undefined,
      })

      // Sessiz kaynak: hata değil; boş dalga formu çizilir.
      if (response.silent || !response.buckets) {
        log("info", "Kaynakta ses akışı yok: dalga formu çizilmiyor.")
        return { buckets: new Uint8Array(0), bucketSeconds: response.bucket_seconds || 0.25 }
      }

      const buckets = decodeBuckets(response.buckets)
      const elapsed = Math.round(performance.now() - started)
      if (response.cached) {
        log("info", `Dalga formu önbellekten geldi (${elapsed} ms).`)
      } else {
        const note = response.optimized ? " — hafif kaynak kullanıldı" : ""
        log(
          "success",
          `Dalga formu hazır: ${response.bucket_count} kova (${response.bucket_seconds} sn), ${elapsed} ms${note}.`,
        )
      }

      return { buckets, bucketSeconds: response.bucket_seconds || 0.25 }
    },
  })

  useEffect(() => {
    if (!query.error) return
    log(
      "warn",
      "Dalga formu alınamadı",
      query.error instanceof Error ? query.error.message : undefined,
    )
  }, [query.error])

  return { data: query.data ?? null, loading: enabled && query.isPending }
}
