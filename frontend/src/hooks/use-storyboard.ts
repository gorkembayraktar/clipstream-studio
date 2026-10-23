/** Zaman çizelgesi storyboard'unu kademeli olarak hazırlar.
 *
 * İlk grup tüm süreye eşit dağıtılmış 10 karedir ve hızla yüklenir. Sonraki
 * gruplar arka planda boşlukları doldurur. Sunucu her grup için ayrı JPEG
 * sprite döner; istemci hover sırasında yeni istek atmadan en yakın kareyi
 * CSS ile yerel olarak kırpar.
 */
import { useEffect, useState } from "react"

import { translate } from "@/i18n"
import { api } from "@/lib/api"
import type { StoryboardBatchMeta, StoryboardMeta } from "@/lib/types"
import { log } from "@/stores/log-store"
import { useSourceStore } from "@/stores/source-store"

/** Sprite'ı hover'dan önce tarayıcı önbelleğine alır. */
function preloadSheet(src: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const onAbort = () => {
      image.src = ""
      reject(new DOMException("Aborted", "AbortError"))
    }
    const cleanup = () => signal.removeEventListener("abort", onAbort)
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }
    signal.addEventListener("abort", onAbort, { once: true })
    image.onload = () => {
      cleanup()
      resolve()
    }
    image.onerror = () => {
      cleanup()
      reject(new Error(translate("timeline.storyboardFailed")))
    }
    image.src = src
  })
}

function aggregate(
  batches: StoryboardBatchMeta[],
): StoryboardMeta | null {
  const first = batches[0]
  if (!first) return null
  return {
    duration: first.duration,
    interval: first.interval,
    tile_width: first.tile_width,
    tile_height: first.tile_height,
    count: first.count,
    complete: batches[batches.length - 1]?.complete ?? false,
    batches,
  }
}

export function useStoryboard(url: string | null, duration: number) {
  const headers = useSourceStore((s) => s.headers)
  const sourcePath = useSourceStore((s) => s.sourcePath)
  const origin = useSourceStore((s) => s.sourceOrigin)
  const [meta, setMeta] = useState<StoryboardMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const headersKey = JSON.stringify(headers ?? {})

  useEffect(() => {
    if (!url || duration <= 0) {
      setMeta(null)
      setLoading(false)
      setFailed(false)
      return
    }

    const controller = new AbortController()
    const batches: StoryboardBatchMeta[] = []
    let cancelled = false
    const started = performance.now()
    setMeta(null)
    setLoading(true)
    setFailed(false)
    log("info", translate("log.storyboardPreparing"), url)

    void (async () => {
      try {
        for (let batch = 0; ; batch += 1) {
          const data = await api.storyboard(
            {
              url,
              origin: origin ?? undefined,
              duration,
              identity: sourcePath || undefined,
              headers: headers ?? undefined,
              batch,
            },
            controller.signal,
          )
          if (cancelled) return

          await preloadSheet(data.sheet_url, controller.signal)
          if (cancelled) return

          batches.push(data)
          setMeta(aggregate(batches))

          if (batch === 0) {
            setLoading(false)
            log(
              "success",
              translate("log.storyboardReady", {
                count: data.batch_count,
                ms: Math.round(performance.now() - started),
              }),
              data.cached ? translate("log.storyboardCached") : undefined,
            )
          }

          if (data.complete || batch + 1 >= data.total_batches) {
            if (batch > 0) {
              log(
                "success",
                translate("log.storyboardComplete", { count: data.count }),
              )
            }
            break
          }
        }
      } catch (error: unknown) {
        if (cancelled || controller.signal.aborted) return
        setLoading(false)
        if (batches.length === 0) setFailed(true)
        log(
          "warn",
          translate("timeline.storyboardFailed"),
          error instanceof Error ? error.message : undefined,
        )
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
    // headersKey, başlık nesnesinin içeriği değişmediğinde yeniden istemeyi önler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, origin, duration, sourcePath, headersKey])

  return { meta, loading, failed }
}
