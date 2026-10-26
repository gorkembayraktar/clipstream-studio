/** Kaynağın dalga formunu tek istekle getirir ve iki çizelgeye paylaştırır.
 *
 * Kaynak çizelgesi ile çıktı şeridi aynı veriyi farklı zaman eksenlerinde
 * çizer; isteği iki kez atmamak için veri burada bir kez üretilir.
 */
import { createContext, useContext, type ReactNode } from "react"

import { useWaveform, type WaveformData } from "@/hooks/use-waveform"
import { usePlayerStore } from "@/stores/player-store"
import { useSourceStore } from "@/stores/source-store"

const WaveformContext = createContext<WaveformData | null>(null)

export function WaveformProvider({ children }: { children: ReactNode }) {
  const streamUrl = useSourceStore((s) => s.streamUrl)
  const origin = useSourceStore((s) => s.sourceOrigin)
  const audioUrl = useSourceStore((s) => s.audioUrl)
  const audioTrackId = useSourceStore((s) => s.audioTrackId)
  const hasAudio = useSourceStore((s) => s.meta?.hasAudio)
  const metaDuration = useSourceStore((s) => s.meta?.duration ?? 0)
  const isLive = useSourceStore((s) => s.isLive)
  const playerDuration = usePlayerStore((s) => s.duration)

  // Kaynak çizelgesiyle aynı süre kuralı: canlı yayında sonlu süre yoktur.
  const duration = isLive ? 0 : playerDuration || metaDuration
  // Video akışı sessizse (ör. YouTube HLS) dalga formu ayrı ses akışından çıkar.
  const waveformAudioUrl = audioTrackId || hasAudio === false ? audioUrl : null

  const { data } = useWaveform(
    streamUrl,
    origin,
    duration,
    waveformAudioUrl,
    hasAudio ?? null,
    audioTrackId,
  )

  return <WaveformContext.Provider value={data}>{children}</WaveformContext.Provider>
}

/** Paylaşılan dalga formu verisi (hazır değilse null). */
export function useWaveformData(): WaveformData | null {
  return useContext(WaveformContext)
}
