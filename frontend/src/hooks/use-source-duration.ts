/** Kaynağın sonlu süresi (canlı yayında 0).
 *
 * Zaman çizelgesi, dalga formu ve storyboard aynı süre kuralını kullanır:
 * proje akışında segment süreleri toplamı (meta) esastır — oynatıcı HLS'in
 * `Infinity` süresi bildirme ihtimali vardır ve akış sürümü değişene kadar
 * meta daha güvenilirdir. Diğer kaynaklarda oynatıcı süresi, yoksa meta.
 */
import { usePlayerStore } from "@/stores/player-store"
import { useSourceStore } from "@/stores/source-store"

export function useSourceDuration(): number {
  const metaDuration = useSourceStore((s) => s.meta?.duration ?? 0)
  const isLive = useSourceStore((s) => s.isLive)
  const streamId = useSourceStore((s) => s.streamId)
  const playerDuration = usePlayerStore((s) => s.duration)
  // Canlı yayında sonlu bir süre yoktur.
  if (isLive) return 0
  // Proje akışı: süre backend özetinden gelir (segment sürelerinin toplamı).
  if (streamId) return metaDuration || playerDuration
  return playerDuration || metaDuration
}
