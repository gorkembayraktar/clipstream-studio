/** Sürükle-bırakla açılan yeni proje sekmesini hazırlar.
 *
 * Kaynak sekme dosyayı yüklerken bu sekme "hazırlanıyor" ekranını gösterir.
 * Sonuç `localStorage` kaydına yazıldığında (`storage` olayı) dosya stüdyoya
 * bağlanır ve URL'deki `incoming` parametresi temizlenir.
 */
import { useEffect, useRef, useState } from "react"

import { translate } from "@/i18n"
import { formatTime, stripExtension } from "@/lib/format"
import {
  projectKey,
  readProjectHandoff,
  removeProjectHandoff,
  type ProjectHandoff,
} from "@/lib/project-handoff"
import type { LocalFileResponse } from "@/lib/types"
import { useExportStore } from "@/stores/export-store"
import { log } from "@/stores/log-store"
import { useSourceStore } from "@/stores/source-store"

/** Dosya aktarımı bu süreden uzun sürerse kullanıcıya bilgi ver. */
const INCOMING_TIMEOUT_MS = 15 * 60 * 1000

export interface IncomingProjectState {
  /** Bekleme/ekran gösterilsin mi? */
  active: boolean
  fileName: string | null
  /** Doluysa hazırlık başarısız/iptal edildi. */
  error: string | null
}

const INACTIVE: IncomingProjectState = { active: false, fileName: null, error: null }

function readIncomingId(): string | null {
  if (typeof window === "undefined") return null
  return new URLSearchParams(window.location.search).get("incoming")
}

function applyLocalResult(result: LocalFileResponse): void {
  const source = useSourceStore.getState()
  source.setUseProxy(false)
  source.setSource({
    streamUrl: result.url,
    title: result.name,
    resolution: result.width > 0 ? `${result.width}×${result.height}` : null,
    platform: "local",
    sourcePath: result.path ?? null,
    previewCopy: Boolean(result.remuxed),
    audioUrl: null,
    variants: [],
    isHls: false,
  })
  source.setMeta({
    width: result.width,
    height: result.height,
    duration: result.duration,
    hasAudio: result.has_audio,
    fps: result.fps > 0 ? result.fps : undefined,
  })

  const current = useExportStore.getState()
  if (!current.filename.trim()) current.setFilename(stripExtension(result.name))

  log(
    "success",
    translate("import.newProjectReadyLog", { name: result.name }),
    translate("import.newProjectReadyExtra", {
      size: `${result.width}×${result.height} · ${formatTime(result.duration)}`,
    }),
  )
  if (result.remuxed) {
    log("info", translate("import.remuxed"))
  }
}

/** `incoming` parametresi varsa yükleme sonucunu bekler; yoksa hemen pasif döner. */
export function useIncomingProject(): IncomingProjectState {
  const [incomingId] = useState(readIncomingId)
  const [state, setState] = useState<IncomingProjectState>(() => {
    if (!incomingId) return INACTIVE
    const handoff = readProjectHandoff(incomingId)
    return { active: true, fileName: handoff?.name ?? null, error: null }
  })
  /** React StrictMode etkileri iki kez çalıştığında sonucu iki kez uygulamayı önler. */
  const settledRef = useRef(false)

  useEffect(() => {
    if (!incomingId || settledRef.current) return

    let timer: number | undefined

    const settleError = (message: string, fileName: string | null) => {
      if (settledRef.current) return
      settledRef.current = true
      if (timer !== undefined) window.clearTimeout(timer)
      setState({ active: true, fileName, error: message })
    }

    const inspect = (data: ProjectHandoff | null) => {
      if (settledRef.current) return

      if (!data) {
        settleError(translate("incoming.error.notFound"), null)
        return
      }

      if (data.status === "ready") {
        if (!data.result) {
          settleError(translate("incoming.error.missingResult"), data.name)
          return
        }
        settledRef.current = true
        if (timer !== undefined) window.clearTimeout(timer)
        applyLocalResult(data.result)

        // URL'yi sadeleştir: yenilemede artık bekleyen bir proje yok.
        const url = new URL(window.location.href)
        url.searchParams.delete("incoming")
        window.history.replaceState(
          window.history.state,
          "",
          `${url.pathname}${url.search}${url.hash}`,
        )
        removeProjectHandoff(incomingId)
        setState(INACTIVE)
        return
      }

      if (data.status === "error") {
        settleError(data.error ?? translate("incoming.error.transferFailed"), data.name)
        return
      }

      if (data.status === "cancelled") {
        settleError(translate("incoming.error.cancelled"), data.name)
        return
      }

      // uploading: dosya adını erkenden göster, beklemeye devam et.
      setState((current) =>
        current.active && current.fileName !== data.name
          ? { ...current, fileName: data.name }
          : current,
      )
    }

    inspect(readProjectHandoff(incomingId))
    // Kayıt zaten hazırsa (veya hemen hata verdiyse) dinleyici/zamanlayıcı kurma.
    if (settledRef.current) return

    const onStorage = (event: StorageEvent) => {
      if (event.key !== projectKey(incomingId)) return
      inspect(readProjectHandoff(incomingId))
    }
    window.addEventListener("storage", onStorage)

    timer = window.setTimeout(() => {
      const handoff = readProjectHandoff(incomingId)
      settleError(
        translate("incoming.error.timeout"),
        handoff?.name ?? null,
      )
    }, INCOMING_TIMEOUT_MS)

    return () => {
      window.removeEventListener("storage", onStorage)
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [incomingId])

  return state
}
