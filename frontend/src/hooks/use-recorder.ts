/** Kayıt listesini yoklar: süren kayıt varsa sık, yoksa seyrek.
 *
 * Kayıt backend'de sürdüğü için bu yoklama yalnızca arayüzü günceller; sayfa
 * kapansa da yakalama devam eder. Kayıt bittiğinde akış özeti de tazelenir
 * (`recorder-store.refresh`), böylece yeni blok zaman çizelgesinde görünür.
 */
import { useEffect } from "react"

import { useRecorderStore } from "@/stores/recorder-store"

/** Süren kayıt varken yoklama aralığı (ms) — süre sayacı canlı ilerlesin. */
export const RECORDER_ACTIVE_POLL_MS = 2000
/** Boştaki yoklama aralığı (ms): başka sekmede başlatılan kayıt da görünür. */
export const RECORDER_IDLE_POLL_MS = 10000

export function useRecorder(): void {
  const refresh = useRecorderStore((s) => s.refresh)
  // Yalnızca süren/duraklatılmış kayıt varken sık yokla.
  const active = useRecorderStore((s) => s.recordings.length > 0)

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(
      () => void refresh(),
      active ? RECORDER_ACTIVE_POLL_MS : RECORDER_IDLE_POLL_MS,
    )
    return () => window.clearInterval(timer)
  }, [active, refresh])
}
