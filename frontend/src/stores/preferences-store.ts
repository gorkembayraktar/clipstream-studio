/** Kullanıcı tercihleri: yeni dalga formu üretimini açıp kapatan kalıcı bayrak.
 *
 * Kapalıyken önbellekteki dalga formları yine gösterilir; yalnızca yeni
 * çıkarım isteği engellenir.
 */
import { create } from "zustand"

const WAVEFORM_ENABLED_KEY = "clip2:waveform-enabled"

function readWaveformEnabled(): boolean {
  if (typeof window === "undefined") return true
  try {
    const raw = window.localStorage.getItem(WAVEFORM_ENABLED_KEY)
    if (raw === "true") return true
    if (raw === "false") return false
  } catch {
    /* gizli sekme vb. durumlarda varsayılan kullanılır */
  }
  return true
}

function persistWaveformEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(WAVEFORM_ENABLED_KEY, String(enabled))
  } catch {
    /* gizli sekme vb. durumlarda sessizce yok sayılır */
  }
}

interface PreferencesState {
  /** Açıkken yeni dalga formu üretilir; kapalıyken yalnızca önbellek kullanılır. */
  waveformEnabled: boolean
  setWaveformEnabled: (enabled: boolean) => void
}

export const usePreferencesStore = create<PreferencesState>()((set) => ({
  waveformEnabled: readWaveformEnabled(),

  setWaveformEnabled: (enabled) => {
    persistWaveformEnabled(enabled)
    set({ waveformEnabled: enabled })
  },
}))
