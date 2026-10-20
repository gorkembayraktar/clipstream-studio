/** HLS (m3u8) kaynaklarını hls.js ile video elementine bağlar.
 *
 * hls.js yalnızca gerçekten HLS kaynağı gerektiğinde dinamik olarak yüklenir;
 * böylece mp4/dosya oynatmalarında ilk yükleme hafif kalır.
 */
import { useEffect, type RefObject } from "react"

import type HlsJs from "hls.js"
import { toast } from "sonner"

import { isHlsUrl } from "@/lib/media"
import { log } from "@/stores/log-store"

export function useHlsSource(
  videoRef: RefObject<HTMLVideoElement | null>,
  src: string | null,
) {
  useEffect(() => {
    const el = videoRef.current
    if (!el || !src) return

    let hls: HlsJs | null = null
    let disposed = false

    const setup = async () => {
      if (isHlsUrl(src)) {
        log("info", "Hls.js oynatıcı motoru başlatılıyor...")
        const { default: Hls } = await import("hls.js")
        if (disposed) return

        if (Hls.isSupported()) {
          hls = new Hls({ enableWorker: true, backBufferLength: 90 })
          hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
            log("success", `HLS manifest yüklendi (seviye sayısı: ${data.levels.length})`, src)
          })
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal || !hls) return
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                log(
                  "warn",
                  "Ağ hatası: segment veya m3u8 indirilemedi (403/404/CORS olabilir), yeniden deneniyor.",
                  String(data.details),
                )
                hls.startLoad()
                break
              case Hls.ErrorTypes.MEDIA_ERROR:
                log(
                  "warn",
                  "Medya hatası: kod çözme sorunu, kurtarma deneniyor.",
                  String(data.details),
                )
                hls.recoverMediaError()
                break
              default:
                log("error", "Akış oynatılamadı (kurtarılamayan Hls.js hatası).", String(data.details))
                toast.error("Akış oynatılamadı", { description: String(data.details) })
                hls.destroy()
            }
          })
          hls.loadSource(src)
          hls.attachMedia(el)
        } else if (el.canPlayType("application/vnd.apple.mpegurl")) {
          // Safari: yerel HLS desteği
          log("info", "Tarayıcının yerel HLS desteği kullanılıyor.")
          el.src = src
        } else {
          log("error", "Tarayıcı HLS oynatmayı desteklemiyor.")
          toast.error("Tarayıcı HLS oynatmayı desteklemiyor.")
        }
      } else {
        log("info", `Video nesnesi yükleniyor: ${src}`)
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
  }, [src, videoRef])
}
