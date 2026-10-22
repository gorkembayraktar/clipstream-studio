/** Varsayılan klavye kısayolları.
 *
 * Ayarlar tablosu ve ileride kısayol atama ekranı aynı listeyi kullanır.
 * Şimdilik yalnızca görüntüleme amaçlıdır; tuşlar `use-keyboard-shortcuts.ts`
 * içindeki varsayılan davranışla eşleşir.
 */
import type { TranslationKey } from "@/i18n"

export type ShortcutId =
  | "playPause"
  | "seekCoarse"
  | "seekCoarseShift"
  | "step"
  | "step10"
  | "volume"
  | "mute"
  | "fullscreen"
  | "pip"
  | "theme"
  | "trimIn"
  | "trimOut"
  | "loop"

export interface KeyboardShortcut {
  id: ShortcutId
  keys: string[]
  labelKey: TranslationKey
}

export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  { id: "playPause", keys: ["Space"], labelKey: "shortcut.playPause" },
  { id: "seekCoarse", keys: ["←", "→"], labelKey: "shortcut.seekCoarse" },
  { id: "seekCoarseShift", keys: ["Shift", "←", "→"], labelKey: "shortcut.seekCoarseShift" },
  { id: "step", keys: [",", "."], labelKey: "shortcut.step" },
  { id: "step10", keys: ["Shift", ",", "."], labelKey: "shortcut.step10" },
  { id: "volume", keys: ["↑", "↓"], labelKey: "shortcut.volume" },
  { id: "mute", keys: ["M"], labelKey: "shortcut.mute" },
  { id: "fullscreen", keys: ["F"], labelKey: "shortcut.fullscreen" },
  { id: "pip", keys: ["P"], labelKey: "shortcut.pip" },
  { id: "theme", keys: ["T"], labelKey: "shortcut.theme" },
  { id: "trimIn", keys: ["I", "["], labelKey: "shortcut.trimIn" },
  { id: "trimOut", keys: ["O", "]"], labelKey: "shortcut.trimOut" },
  { id: "loop", keys: ["L"], labelKey: "shortcut.loop" },
]
