/** Üst çubuktaki proje adı: tıklanınca satır içi düzenlenir.
 *
 * Enter veya dışarı tıklama kaydeder, Escape vazgeçer. Boş bırakılan ad
 * kaynak başlığına döner.
 */
import { useEffect, useRef, useState } from "react"

import { PencilIcon } from "lucide-react"

import { useI18n } from "@/i18n"
import { PROJECT_TITLE_MAX } from "@/lib/project-workspace"
import { cn } from "cn"

interface ProjectTitleFieldProps {
  /** Kullanıcının verdiği ad (yoksa null). */
  title: string | null
  /** Ad yokken gösterilen kaynak başlığı. */
  fallback: string
  onRename: (title: string) => void
}

export function ProjectTitleField({
  title,
  fallback,
  onRename,
}: ProjectTitleFieldProps) {
  const { t } = useI18n()
  const display = title ?? fallback
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(display)
  const inputRef = useRef<HTMLInputElement>(null)
  /** Escape ile kapatıldıysa blur'un kaydetmesini engeller. */
  const cancelledRef = useRef(false)

  useEffect(() => {
    if (!editing) return
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [editing])

  const startEditing = () => {
    cancelledRef.current = false
    setDraft(display)
    setEditing(true)
  }

  const commit = () => {
    if (!editing) return
    setEditing(false)
    if (cancelledRef.current) {
      cancelledRef.current = false
      setDraft(display)
      return
    }
    const next = draft.trim()
    if (next === display) return
    onRename(next)
  }

  const cancel = () => {
    cancelledRef.current = true
    setEditing(false)
    setDraft(display)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        maxLength={PROJECT_TITLE_MAX}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            commit()
          } else if (event.key === "Escape") {
            event.preventDefault()
            cancel()
          }
        }}
        aria-label={t("project.rename")}
        placeholder={fallback}
        className="h-7 w-[min(38vw,18rem)] min-w-24 rounded-md border border-border/70 bg-background px-2 text-xs font-medium outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      title={t("project.rename")}
      aria-label={`${t("project.rename")}: ${display}`}
      className={cn(
        "group/title flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5",
        "text-xs font-medium text-foreground/90 transition-colors",
        "hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      )}
    >
      <span className="max-w-[34vw] truncate">{display}</span>
      <PencilIcon className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100 group-focus-visible/title:opacity-100" />
    </button>
  )
}
