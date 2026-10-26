/** Storyboard'u tek istekle getirir ve iki zaman çizelgesine paylaştırır.
 *
 * Ana çizelge ile kaynak şeridi aynı kare önizlemelerini kullanır; isteği iki
 * kez atmamak için veri burada bir kez üretilir.
 */
import { createContext, useContext, type ReactNode } from "react"

import { useSourceDuration } from "@/hooks/use-source-duration"
import { useStoryboard } from "@/hooks/use-storyboard"
import type { StoryboardMeta } from "@/lib/types"
import { useSourceStore } from "@/stores/source-store"

interface StoryboardState {
  meta: StoryboardMeta | null
  loading: boolean
  failed: boolean
}

const EMPTY: StoryboardState = { meta: null, loading: false, failed: false }

const StoryboardContext = createContext<StoryboardState>(EMPTY)

export function StoryboardProvider({ children }: { children: ReactNode }) {
  const streamUrl = useSourceStore((s) => s.streamUrl)
  const duration = useSourceDuration()
  const state = useStoryboard(streamUrl, duration)

  return <StoryboardContext.Provider value={state}>{children}</StoryboardContext.Provider>
}

/** Paylaşılan storyboard durumu (henüz hazır değilse boş). */
export function useStoryboardData(): StoryboardState {
  return useContext(StoryboardContext)
}
