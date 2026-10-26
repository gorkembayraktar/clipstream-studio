/** Kaynağın sonlu süresi (canlı yayında 0).
 *
 * Zaman çizelgesi, dalga formu ve storyboard aynı süre kuralını kullanır:
 * oynatıcı süresi hazırsa o, yoksa meta verideki süre.
 */
import { usePlayerStore } from "@/stores/player-store"
import { useSourceStore } from "@/stores/source-store"

export function useSourceDuration(): number {
  const metaDuration = useSourceStore((s) => s.meta?.duration ?? 0)
  const isLive = useSourceStore((s) => s.isLive)
  const playerDuration = usePlayerStore((s) => s.duration)
  // Canlı yayında sonlu bir süre yoktur.
  return isLive ? 0 : playerDuration || metaDuration
}
