/** Seçili HLS WebVTT altyazısını indirip `<track>` için blob adresine çevirir. */
import { useEffect, useState } from "react"

import { api } from "@/lib/api"
import { translate } from "@/i18n"
import type { HlsSubtitleTrack } from "@/lib/types"
import { log } from "@/stores/log-store"

export function useSubtitleVtt(
  track: HlsSubtitleTrack | null,
  headers: Record<string, string> | null,
) {
  const [src, setSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const headersKey = JSON.stringify(headers ?? {})

  useEffect(() => {
    if (!track) {
      setSrc(null)
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    let cancelled = false
    let objectUrl: string | null = null

    setSrc(null)
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const result = await api.subtitles(
          track.url,
          headers,
          controller.signal,
        )
        if (cancelled) return
        const blob = new Blob([result.vtt], {
          type: "text/vtt;charset=utf-8",
        })
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
        log("info", translate("log.subtitleTrack", { name: track.name }))
      } catch (err) {
        if (
          cancelled ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return
        }
        const next = err instanceof Error ? err : new Error(String(err))
        setError(next)
        log("warn", translate("log.subtitleLoadFailed"), next.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // `headersKey`, headers nesnesinin içeriğini temsil eder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.url, headersKey])

  return { src, loading, error }
}
