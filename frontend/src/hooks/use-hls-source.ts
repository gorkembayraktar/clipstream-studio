/** HLS (m3u8) kaynaklarını hls.js ile video elementine bağlar.
 *
 * hls.js yalnızca gerçekten HLS kaynağı gerektiğinde dinamik olarak yüklenir;
 * böylece mp4/dosya oynatmalarında ilk yükleme hafif kalır.
 */
import { useEffect, type RefObject } from "react"

import type HlsJs from "hls.js"
import { toast } from "sonner"

import { translate } from "@/i18n"
import { isHlsUrl } from "@/lib/media"
import { log } from "@/stores/log-store"

export function useHlsSource(
  videoRef: RefObject<HTMLVideoElement | null>,
  src: string | null,
  isHls = false,
) {
  useEffect(() => {
    const el = videoRef.current
    if (!el || !src) return

    let hls: HlsJs | null = null
    let disposed = false
    const reported = new Set<string>()
    let mediaRecoveryAttempted = false

    /** Aynı fatal hatayı her yeniden denemede tekrar toast'lamamak için. */
    const report = (
      key: string,
      title: string,
      description: string,
      level: "error" | "warn" = "error",
    ) => {
      if (reported.has(key)) return
      reported.add(key)
      log(level, title, description)
      if (level === "error") {
        toast.error(title, { description })
      } else {
        toast.warning(title, { description })
      }
    }

    const setup = async () => {
      // Uzantısız HLS playlist'lerinde URL kontrolü yetersiz kalır; backend'in
      // içerik tespiti `isHls` ile ayrıca iletilir.
      if (isHls || isHlsUrl(src)) {
        log("info", translate("hls.engineStarting"))
        const { default: Hls } = await import("hls.js")
        if (disposed) return

        if (Hls.isSupported()) {
          hls = new Hls({ enableWorker: true, backBufferLength: 90 })
          hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
            log(
              "success",
              translate("hls.manifestLoaded", { levels: data.levels.length }),
              src,
            )
          })
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal || !hls) return

            const response = (
              data as {
                response?: { code?: number; text?: string }
              }
            ).response
            const code = response?.code
            const details = String(data.details)
            const isSegment = details.toLowerCase().includes("frag")
            const isCodec =
              details.includes("Codec") ||
              details.includes("codec") ||
              details.includes("manifestIncompatibleCodecs")

            if (code === 401 || code === 403) {
              report(
                `forbidden-${code}`,
                translate("hls.errorForbiddenTitle"),
                translate("hls.errorForbidden", { status: code }),
              )
              hls.destroy()
              hls = null
              return
            }

            if (code === 404) {
              report(
                isSegment ? "segment-404" : "playlist-404",
                translate(
                  isSegment
                    ? "hls.errorSegmentTitle"
                    : "hls.errorNotFoundTitle",
                ),
                translate(
                  isSegment ? "hls.errorSegment" : "hls.errorNotFound",
                ),
              )
              hls.destroy()
              hls = null
              return
            }

            if (code === 429) {
              report(
                "rate-limited",
                translate("hls.errorRateLimitedTitle"),
                translate("hls.errorRateLimited"),
              )
              hls.destroy()
              hls = null
              return
            }

            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              if (code && code >= 500) {
                report(
                  "server-error",
                  translate("hls.errorServerTitle"),
                  translate("hls.errorServer", { status: code }),
                  "warn",
                )
              } else if (!code) {
                // Durum kodu yoksa istek tarayıcıdan hiç çıkmamıştır: CORS,
                // DNS veya ağ engeli. Proxy açmak çoğu durumda çözer.
                report(
                  "network-cors",
                  translate("hls.errorCorsTitle"),
                  translate("hls.errorCors"),
                )
              }
              // Geçici ağ hatalarında hls.js'in kendi yeniden denemesine izin ver.
              hls.startLoad()
              return
            }

            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              if (isCodec) {
                report(
                  "codec",
                  translate("hls.errorCodecTitle"),
                  translate("hls.errorCodec"),
                )
                hls.destroy()
                hls = null
                return
              }
              if (!mediaRecoveryAttempted) {
                mediaRecoveryAttempted = true
                report(
                  "media-recovery",
                  translate("hls.errorCodecTitle"),
                  translate("hls.errorCodec"),
                  "warn",
                )
                hls.recoverMediaError()
                return
              }
              report(
                "media-fatal",
                translate("hls.fatalTitle"),
                translate("hls.mediaError"),
              )
              hls.destroy()
              hls = null
              return
            }

            report(
              "fatal",
              translate("hls.fatalTitle"),
              translate("hls.errorGeneric", { details }),
            )
            hls.destroy()
            hls = null
          })
          hls.loadSource(src)
          hls.attachMedia(el)
        } else if (el.canPlayType("application/vnd.apple.mpegurl")) {
          // Safari: yerel HLS desteği
          log("info", translate("hls.native"))
          el.src = src
        } else {
          log("error", translate("hls.unsupported"))
          toast.error(translate("hls.unsupportedTitle"))
        }
      } else {
        log("info", translate("hls.loadingMedia", { src }))
        el.src = src
      }
    }

    void setup()

    return () => {
      disposed = true
      hls?.destroy()
      el.removeAttribute("src")
      el.load()
    }
  }, [src, videoRef, isHls])
}
