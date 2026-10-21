/** Global klavye kısayolları: Boşluk, I/O, L, ←/→, ↑/↓, M, F, P, T, ,/. */
import { useEffect } from "react"

import { toggleStageFullscreen } from "@/hooks/use-fullscreen"
import { getVideoElement, usePlayerStore, VOLUME_STEP } from "@/stores/player-store"
import { useEditStore } from "@/stores/edit-store"
import { useThemeStore } from "@/stores/theme-store"

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isEditableTarget(event.target)) return

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
          player.seekBy(event.shiftKey ? -5 : -1)
          break
        case "ArrowRight":
          event.preventDefault()
          player.seekBy(event.shiftKey ? 5 : 1)
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
