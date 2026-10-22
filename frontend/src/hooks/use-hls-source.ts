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
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                log(
                  "warn",
                  translate("hls.networkError"),
                  String(data.details),
                )
                hls.startLoad()
                break
              case Hls.ErrorTypes.MEDIA_ERROR:
                log(
                  "warn",
                  translate("hls.mediaError"),
                  String(data.details),
                )
                hls.recoverMediaError()
                break
              default:
                log("error", translate("hls.fatal"), String(data.details))
                toast.error(translate("hls.fatalTitle"), {
                  description: String(data.details),
                })
                hls.destroy()
            }
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
