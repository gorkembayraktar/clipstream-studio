/** Tam ekran yardımcıları: sahne kartını (video + kontrol şeridi) tam ekranda gösterir. */
import { useCallback, useEffect, useState } from "react"

import { log } from "@/stores/log-store"

/** Tam ekranda gösterilecek sahne kökü — video ve kontroller birlikte görünür. */
export function getStageElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="video-stage"]')
}

/** Sahneyi tam ekrana alır / tam ekrandan çıkarır (kullanıcı hareketi içinde çağrılmalı). */
export function toggleStageFullscreen() {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => {
      log("warn", "Tam ekrandan çıkılamadı.")
    })
    return
  }

  const stage = getStageElement()
  if (!stage?.requestFullscreen) {
    log("warn", "Tam ekran bu tarayıcıda desteklenmiyor.")
    return
  }

  void stage.requestFullscreen().catch((error: unknown) => {
    log("warn", "Tam ekran açılamadı", error instanceof Error ? error.message : undefined)
  })
}

/** Tam ekran durumunu izler ve değiştirme işlevini döndürür. */
export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const onChange = () => {
      const active = Boolean(document.fullscreenElement)
      setIsFullscreen(active)
      log("info", active ? "Tam ekran açıldı." : "Tam ekrandan çıkıldı.")
    }
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  const toggle = useCallback(() => toggleStageFullscreen(), [])

  return { isFullscreen, toggle }
}
