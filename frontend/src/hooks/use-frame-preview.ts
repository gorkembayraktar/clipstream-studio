/** Zaman çizelgesi hover'ı için sunucudan tek kare getirir (ana video ilerletilmez).
 *
 * - İstekler geciktirilir ve önceki istek iptal edilir: hızlı fare süpürmesinde
 *   sunucuda tek çıkarım kalır.
 * - Nesne URL'leri küçük bir LRU önbelleğinde tutulur (sunucuda da önbellek var).
 */
import { useCallback, useEffect, useRef, useState } from "react"

import { api } from "@/lib/api"
import { translate } from "@/i18n"
import { log } from "@/stores/log-store"
import { useSourceStore } from "@/stores/source-store"

export interface FramePreview {
  /** Kareyi isterken kullanılan zaman (sn). */
  time: number
  /** objectURL */
  src: string
}

/** Aynı kareyi yeniden istememek için nesne URL önbelleği. */
const objectUrls = new Map<string, string>()
const MAX_OBJECT_URLS = 60
/** Hover'da isteğin gecikmesi (ms). */
const DEBOUNCE_MS = 140

function cacheKey(
  url: string,
  origin: string,
  time: number,
  headers: Record<string, string> | null,
): string {
  // Sunucu zamanı 0,5 sn'lik kovalara yuvarlar
  return `${url}|${origin}|${Math.round(time * 2)}|${JSON.stringify(headers ?? {})}`
}

function remember(key: string, src: string) {
  const previous = objectUrls.get(key)
  if (previous) URL.revokeObjectURL(previous)
  objectUrls.delete(key)
  objectUrls.set(key, src)

  while (objectUrls.size > MAX_OBJECT_URLS) {
    const oldest = objectUrls.keys().next().value
    if (oldest === undefined) break
    const stale = objectUrls.get(oldest)
    objectUrls.delete(oldest)
    if (stale) URL.revokeObjectURL(stale)
  }
}

export function useFramePreview(url: string | null, origin: string, duration: number) {
  const headers = useSourceStore((s) => s.headers)
  const [preview, setPreview] = useState<FramePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const timerRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const failureLoggedRef = useRef(false)

  const cancel = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = 0
    }
    controllerRef.current?.abort()
    controllerRef.current = null
    setLoading(false)
  }, [])

  useEffect(() => cancel, [cancel])

  const request = useCallback(
    (time: number) => {
      if (!url || duration <= 0) return

      if (timerRef.current) window.clearTimeout(timerRef.current)
      controllerRef.current?.abort()
      controllerRef.current = null

      const key = cacheKey(url, origin, time, headers)
      const cached = objectUrls.get(key)
      if (cached) {
        setPreview({ time, src: cached })
        setFailed(false)
        setLoading(false)
        return
      }

      setLoading(true)
      timerRef.current = window.setTimeout(() => {
        timerRef.current = 0
        const controller = new AbortController()
        controllerRef.current = controller

        api
          .frame({ url, origin: origin || undefined, time, headers: headers ?? undefined }, controller.signal)
          .then((blob) => {
            if (controller.signal.aborted) return
            const src = URL.createObjectURL(blob)
            remember(key, src)
            setPreview({ time, src })
            setFailed(false)
            failureLoggedRef.current = false
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) return
            setFailed(true)
            if (!failureLoggedRef.current) {
              failureLoggedRef.current = true
              log(
                "warn",
                translate("log.previewFrameFailed"),
                error instanceof Error ? error.message : undefined,
              )
            }
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false)
          })
      }, DEBOUNCE_MS)
    },
    [url, origin, duration, headers],
  )

  return { preview, loading, failed, request, cancel }
}
