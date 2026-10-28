/** Proje rotasını (`#project/?id=<id>&v=<sürüm>` / `#/`) uygulama açılışında kurar. */
import { useEffect } from "react"

import { ensureProjectHash, readProjectIdFromUrl } from "@/lib/project-route"

/** Uygulama yüklendiğinde URL'de olan proje; farklı bir projeye geçiş tam sayfa yüklenir. */
const bootProjectId = readProjectIdFromUrl()

export function useProjectRoute(): void {
  useEffect(() => {
    ensureProjectHash()

    const onHashChange = () => {
      // Başka bir projeye (veya geçmişe) gidildiyse hidrasyon baştan çalışmalı.
      if (readProjectIdFromUrl() !== bootProjectId) {
        window.location.reload()
        return
      }
      ensureProjectHash()
    }
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])
}
