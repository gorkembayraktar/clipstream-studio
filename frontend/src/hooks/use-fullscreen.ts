/** Tam ekran yardımcıları: sahne kartını (video + kontrol şeridi) tam ekranda gösterir. */
import { useCallback, useEffect, useState } from "react"

import { translate } from "@/i18n"
import { log } from "@/stores/log-store"

/** Tam ekranda gösterilecek sahne kökü — video ve kontroller birlikte görünür. */
export function getStageElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="video-stage"]')
}

/** Sahneyi tam ekrana alır / tam ekrandan çıkarır (kullanıcı hareketi içinde çağrılmalı). */
export function toggleStageFullscreen() {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => {
      log("warn", translate("log.fullscreenExitFailed"))
    })
    return
  }

  const stage = getStageElement()
  if (!stage?.requestFullscreen) {
    log("warn", translate("log.fullscreenUnsupported"))
    return
  }

  void stage.requestFullscreen().catch((error: unknown) => {
    log(
      "warn",
      translate("log.fullscreenOpenFailed"),
      error instanceof Error ? error.message : undefined,
    )
  })
}

/** Tam ekran durumunu izler ve değiştirme işlevini döndürür. */
export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const onChange = () => {
      const active = Boolean(document.fullscreenElement)
      setIsFullscreen(active)
      log(
        "info",
        translate(active ? "log.fullscreenOpened" : "log.fullscreenExited"),
      )
    }
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  const toggle = useCallback(() => toggleStageFullscreen(), [])

  return { isFullscreen, toggle }
}
