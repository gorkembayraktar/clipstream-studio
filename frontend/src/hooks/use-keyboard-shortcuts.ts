/** Global klavye kısayolları: Boşluk, I/O, L, ←/→, ↑/↓, M, F, P, T, ,/. */
import { useEffect } from "react"

import { toggleStageFullscreen } from "@/hooks/use-fullscreen"
import {
  getVideoElement,
  SEEK_BACK_SECONDS,
  SEEK_FORWARD_SECONDS,
  usePlayerStore,
  VOLUME_STEP,
} from "@/stores/player-store"
import { useEditStore } from "@/stores/edit-store"
import { useThemeStore } from "@/stores/theme-store"

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable
}

/** Modal içindeki ve native medya kontrollerindeki tuşları ana oynatıcıya gönderme. */
function isModalOrMediaTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest(
      "video, audio, [data-slot='dialog-content'], [data-slot='alert-dialog-content']",
    ),
  )
}

function hasOpenDialog(): boolean {
  return Boolean(
    document.querySelector(
      "[data-slot='dialog-content'][data-state='open'], [data-slot='alert-dialog-content'][data-state='open']",
    ),
  )
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isEditableTarget(event.target) || isModalOrMediaTarget(event.target)) return
      if (hasOpenDialog()) return

      const player = usePlayerStore.getState()
      const edit = useEditStore.getState()
      const currentTime = getVideoElement()?.currentTime ?? player.currentTime

      switch (event.key) {
        case " ":
          event.preventDefault()
          player.toggle()
          break
        case "ArrowLeft":
          event.preventDefault()
          player.seekBy(event.shiftKey ? -SEEK_BACK_SECONDS * 2 : -SEEK_BACK_SECONDS)
          break
        case "ArrowRight":
          event.preventDefault()
          player.seekBy(event.shiftKey ? SEEK_FORWARD_SECONDS * 2 : SEEK_FORWARD_SECONDS)
          break
        case "ArrowUp":
          event.preventDefault()
          player.nudgeVolume(VOLUME_STEP)
          break
        case "ArrowDown":
          event.preventDefault()
          player.nudgeVolume(-VOLUME_STEP)
          break
        case "m":
        case "M":
          player.toggleMute()
          break
        case "f":
        case "F":
          toggleStageFullscreen()
          break
        case "p":
        case "P":
          player.togglePip()
          break
        case "i":
        case "I":
        case "[":
          edit.setTrim({ start: currentTime })
          break
        case "o":
        case "O":
        case "]":
          edit.setTrim({ end: currentTime })
          break
        case "l":
        case "L":
          edit.setLoop(!edit.loop)
          break
        // Sil: seçili aralığı segmentlerden çıkarır (böl + at).
        case "Delete":
        case "Backspace":
          if (edit.selection) {
            event.preventDefault()
            const at = edit.selection.start
            edit.removeSelection()
            player.seek(at)
          }
          break
        case "Escape":
          if (edit.selection) {
            event.preventDefault()
            edit.setSelection(null)
          }
          break
        case "t":
        case "T":
          useThemeStore.getState().toggleTheme()
          break
        // Hassas adım: kare/ms bazında (Shift ile ×10)
        case ",":
          event.preventDefault()
          player.step(event.shiftKey ? -10 : -1)
          break
        case ".":
          event.preventDefault()
          player.step(event.shiftKey ? 10 : 1)
          break
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}
