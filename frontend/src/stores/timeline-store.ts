/** Zaman çizelgesi görünümü: yatay yakınlaştırma seviyeleri. */
import { create } from "zustand"

/** Sırayla kullanılan yakınlaştırma katları. */
export const TIMELINE_ZOOM_LEVELS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16] as const

export const MIN_TIMELINE_ZOOM = TIMELINE_ZOOM_LEVELS[0]
export const MAX_TIMELINE_ZOOM = TIMELINE_ZOOM_LEVELS[TIMELINE_ZOOM_LEVELS.length - 1]

interface TimelineViewState {
  zoom: number
  setZoom: (zoom: number) => void
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
}

export const useTimelineStore = create<TimelineViewState>()((set) => ({
  zoom: MIN_TIMELINE_ZOOM,

  // Kaydırıcıdan gelen değeri desteklenen en yakın üst seviyeye oturt.
  setZoom: (zoom) =>
    set({
      zoom:
        TIMELINE_ZOOM_LEVELS.find((level) => level >= zoom) ??
        MAX_TIMELINE_ZOOM,
    }),

  zoomIn: () =>
    set((state) => ({
      zoom: TIMELINE_ZOOM_LEVELS.find((level) => level > state.zoom) ?? MAX_TIMELINE_ZOOM,
    })),

  zoomOut: () => {
    set((state) => {
      const lower = [...TIMELINE_ZOOM_LEVELS]
        .reverse()
        .find((level) => level < state.zoom)
      return { zoom: lower ?? MIN_TIMELINE_ZOOM }
    })
  },

  resetZoom: () => set({ zoom: MIN_TIMELINE_ZOOM }),
}))
