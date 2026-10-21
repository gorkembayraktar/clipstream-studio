/** Düzenleme durumu: kesim aralığı, döngü ve kırpma. */
import { create } from "zustand"

import { clamp } from "@/lib/format"
import type { AspectPreset, CropRect } from "@/lib/types"

const roundMs = (value: number) => Math.round(value * 1000) / 1000

/** Giriş/çıkış noktaları arasındaki en küçük klip süresi (sn). */
export const MIN_TRIM_SECONDS = 0.05

interface EditState {
  // Kesim
  trim: { start: number; end: number }
  loop: boolean

  // Kırpma
  crop: { enabled: boolean; rect: CropRect | null; aspect: AspectPreset }

  /**
   * Kaynak süresi (sn). Trim tutamaçlarını sınırlamak için `setMeta` ile
   * senkronlanır; kaynak sıfırlandığında 0'a döner.
   */
  sourceDuration: number

  // Eylemler
  setTrim: (partial: Partial<{ start: number; end: number }>) => void
  setLoop: (value: boolean) => void
  setCropEnabled: (value: boolean) => void
  setCropRect: (rect: CropRect | null) => void
  setCropAspect: (aspect: AspectPreset) => void
  /** Kesim ve kırpmayı başlangıç değerlerine döndürür (kaynak değiştiğinde). */
  resetEdit: () => void
  /** Trim aralığını kaynak süresine sığdırır (meta güncellendiğinde). */
  clampTrimToDuration: (duration: number) => void
}

export const useEditStore = create<EditState>()((set) => ({
  trim: { start: 0, end: 0 },
  loop: false,

  crop: { enabled: false, rect: null, aspect: "free" },
  sourceDuration: 0,

  setTrim: (partial) =>
    set((state) => {
      const next = { ...state.trim, ...partial }
      const duration = state.sourceDuration
      const max = duration > 0 ? duration : Number.MAX_SAFE_INTEGER
      const minClip = Math.min(MIN_TRIM_SECONDS, max)

      next.start = clamp(roundMs(next.start), 0, max)
      next.end = clamp(roundMs(next.end), 0, max)

      const movedStart = partial.start !== undefined
      const movedEnd = partial.end !== undefined

      // Tutamaklar birbirini geçerse noktalar yer değiştirir: seçim ters çevrilir.
      // Geçiş minimum klip süresinden kısaysa tutamak diğerinin yanında kalır.
      if (next.start > next.end) {
        if (next.start - next.end >= minClip) {
          const previousStart = next.start
          next.start = next.end
          next.end = previousStart
        } else if (movedStart && !movedEnd) {
          next.start = Math.max(0, next.end - minClip)
        } else if (movedEnd && !movedStart) {
          next.end = Math.min(max, next.start + minClip)
        } else {
          next.start = Math.max(0, next.end - minClip)
        }
      }

      // Son güvenlik: klip her zaman en az minClip kadar olsun.
      if (next.end - next.start < minClip) {
        if (movedStart && !movedEnd) next.start = Math.max(0, next.end - minClip)
        else next.end = Math.min(max, next.start + minClip)
      }

      return { trim: next }
    }),

  setLoop: (value) => set({ loop: value }),

  setCropEnabled: (value) =>
    set((state) => ({ crop: { ...state.crop, enabled: value } })),
  setCropRect: (rect) => set((state) => ({ crop: { ...state.crop, rect } })),
  setCropAspect: (aspect) => set((state) => ({ crop: { ...state.crop, aspect } })),

  resetEdit: () =>
    set({
      trim: { start: 0, end: 0 },
      crop: { enabled: false, rect: null, aspect: "free" },
      sourceDuration: 0,
    }),

  clampTrimToDuration: (duration) =>
    set((state) => {
      const sourceDuration = duration > 0 ? duration : 0
      let { start, end } = state.trim

      if (sourceDuration > 0) {
        if (end <= 0 || end > sourceDuration) end = sourceDuration
        if (start >= end)
          start = clamp(start, 0, Math.max(0, sourceDuration - MIN_TRIM_SECONDS))
      }

      return { sourceDuration, trim: { start, end } }
    }),
}))
