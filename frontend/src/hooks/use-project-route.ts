/** Proje rotasını (`#project/?v=<sürüm>`) uygulama açılışında kurar. */
import { useEffect } from "react"

import { ensureProjectHash } from "@/lib/project-route"

export function useProjectRoute(): void {
  useEffect(() => {
    ensureProjectHash()

    // Kullanıcı hash'i elle değiştirirse sürümü tekrar kanonik hale getir.
    const onHashChange = () => ensureProjectHash()
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])
}
