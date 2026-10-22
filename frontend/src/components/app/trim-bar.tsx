/** Giriş/Çıkış değerlerinin hassas düzenlenmesi ve seçim özeti. */
import { useEffect, useState } from "react"

import { ScissorsIcon } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "cn"
import { useI18n } from "@/i18n"
import { compactDuration, formatTime, parseTimeInput } from "@/lib/format"
import { useEditStore } from "@/stores/edit-store"

interface TimeInputProps {
  value: number
  onCommit: (value: number) => void
  label: string
  disabled?: boolean
}

function TimeInput({ value, onCommit, label, disabled }: TimeInputProps) {
  const [text, setText] = useState(() => formatTime(value, true))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setText(formatTime(value, true))
  }, [value, focused])

  return (
    <Input
      value={text}
      aria-label={label}
      onChange={(event) => setText(event.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        const parsed = parseTimeInput(text)
        if (parsed === null) setText(formatTime(value, true))
        else onCommit(parsed)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur()
      }}
      disabled={disabled}
      className="h-7 w-[110px] font-mono text-xs"
    />
  )
}

export function TrimBar() {
  const { t } = useI18n()
  const trim = useEditStore((s) => s.trim)
  const setTrim = useEditStore((s) => s.setTrim)

  const clip = trim.end - trim.start
  const invalid = clip <= 0.05

  return (
    <div
      data-slot="trim-bar"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-2"
    >
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
          {t("trim.in")}
        </span>
        <TimeInput
          value={trim.start}
          onCommit={(value) => setTrim({ start: value })}
          label={t("trim.in")}
        />
      </label>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
          {t("trim.out")}
        </span>
        <TimeInput
          value={trim.end}
          onCommit={(value) => setTrim({ end: value })}
          label={t("trim.out")}
        />
      </label>

      <span
        data-slot="selection-duration"
        title={formatTime(Math.max(0, clip), true)}
        className={cn(
          "ml-auto flex items-center gap-1.5 font-mono text-xs",
          invalid ? "text-destructive" : "text-muted-foreground",
        )}
      >
        <ScissorsIcon className="size-3.5" />
        {compactDuration(Math.max(0, clip))}
      </span>
    </div>
  )
}
