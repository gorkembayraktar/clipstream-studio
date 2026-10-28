/** Yazıp silen animasyonlu placeholder (typewriter efekti). */
import { useEffect, useState } from "react"

import { cn } from "cn"

export function TypewriterPlaceholder({
  phrases,
  className,
  typingSpeed = 75,
  deletingSpeed = 35,
  holdDuration = 1400,
}: {
  phrases: string[]
  className?: string
  typingSpeed?: number
  deletingSpeed?: number
  holdDuration?: number
}) {
  const [reducedMotion, setReducedMotion] = useState(false)
  const [phraseIndex, setPhraseIndex] = useState(0)
  const [text, setText] = useState("")
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const sync = () => setReducedMotion(query.matches)
    sync()
    query.addEventListener("change", sync)
    return () => query.removeEventListener("change", sync)
  }, [])

  useEffect(() => {
    if (reducedMotion || phrases.length === 0) return
    const phrase = phrases[phraseIndex] ?? ""
    let timeout = 0

    if (!deleting && text === phrase) {
      timeout = window.setTimeout(() => setDeleting(true), holdDuration)
    } else if (deleting && text === "") {
      timeout = window.setTimeout(() => {
        setDeleting(false)
        setPhraseIndex((index) => (index + 1) % phrases.length)
      }, 0)
    } else {
      const next = deleting
        ? phrase.slice(0, Math.max(0, text.length - 1))
        : phrase.slice(0, text.length + 1)
      timeout = window.setTimeout(
        () => setText(next),
        deleting ? deletingSpeed : typingSpeed,
      )
    }

    return () => window.clearTimeout(timeout)
  }, [
    deleting,
    deletingSpeed,
    holdDuration,
    phraseIndex,
    phrases,
    reducedMotion,
    text,
    typingSpeed,
  ])

  if (phrases.length === 0) return null

  const visibleText = reducedMotion ? phrases[0] : text

  return (
    <span className={cn("inline-flex items-center justify-center", className)}>
      <span className="truncate">{visibleText}</span>
      <span
        aria-hidden
        className="typewriter-caret ml-1 inline-block h-[1.05em] w-[2px] shrink-0 rounded-full bg-primary"
      />
    </span>
  )
}
