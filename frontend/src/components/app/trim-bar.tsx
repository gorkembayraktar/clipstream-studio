/** Giriş/Çıkış değerlerinin hassas düzenlenmesi ve hızlı eylemler. */
import { useEffect, useState } from "react"

import { RepeatIcon, RotateCcwIcon, ScissorsIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "cn"
import { useI18n } from "@/i18n"
import { compactDuration, formatTime, parseTimeInput } from "@/lib/format"
import { useStudioStore } from "@/stores/studio-store"

interface TimeInputProps {
  value: number
  onCommit: (value: number) => void
  disabled?: boolean
}

function TimeInput({ value, onCommit, disabled }: TimeInputProps) {
  const [text, setText] = useState(() => formatTime(value, true))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setText(formatTime(value, true))
  }, [value, focused])

  return (
    <Input
      value={text}
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
  const trim = useStudioStore((s) => s.trim)
  const setTrim = useStudioStore((s) => s.setTrim)
  const loop = useStudioStore((s) => s.loop)
  const setLoop = useStudioStore((s) => s.setLoop)
  const duration = useStudioStore((s) => s.meta?.duration ?? 0)

  const clip = trim.end - trim.start
  const invalid = clip <= 0.05

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex items-center gap-1.5">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
          {t("trim.in")}
        </span>
        <TimeInput
          value={trim.start}
          onCommit={(value) => setTrim({ start: value })}
        />
        <Button variant="ghost" size="xs" onClick={() => setTrim({ start: 0 })}>
          {t("trim.fromStart")}
        </Button>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
          {t("trim.out")}
        </span>
        <TimeInput
          value={trim.end}
          onCommit={(value) => setTrim({ end: value })}
        />
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setTrim({ end: duration })}
          disabled={duration <= 0}
        >
          {t("trim.toEnd")}
        </Button>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <span
          className={cn(
            "flex items-center gap-1 font-mono text-xs",
            invalid ? "text-destructive" : "text-muted-foreground",
          )}
        >
          <ScissorsIcon className="size-3.5" />
          {compactDuration(Math.max(0, clip))}
        </span>
        <Button
          variant={loop ? "secondary" : "ghost"}
          size="icon-xs"
          onClick={() => setLoop(!loop)}
          title={t("trim.loop")}
        >
          <RepeatIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setTrim({ start: 0, end: duration })}
          disabled={duration <= 0}
          title={t("trim.fullRange")}
        >
          <RotateCcwIcon />
        </Button>
      </div>
    </div>
  )
}
