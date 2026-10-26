/** Giriş/Çıkış değerlerinin hassas düzenlenmesi, çoklu kesim yönetimi ve seçim özeti. */
import { useEffect, useState } from "react"

import { PlusIcon, RotateCcwIcon, ScissorsIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "cn"
import { useI18n } from "@/i18n"
import { compactDuration, formatTime, parseTimeInput } from "@/lib/format"
import { gapsOf, useEditStore } from "@/stores/edit-store"
import { usePlayerStore } from "@/stores/player-store"
import { useSourceStore } from "@/stores/source-store"

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
  const segments = useEditStore((s) => s.segments)
  const selection = useEditStore((s) => s.selection)
  const removeSelection = useEditStore((s) => s.removeSelection)
  const restoreRange = useEditStore((s) => s.restoreRange)
  const resetSegments = useEditStore((s) => s.resetSegments)
  const seek = usePlayerStore((s) => s.seek)
  const isLive = useSourceStore((s) => s.isLive)

  /** Seçimi keser ve imleci kesim noktasında bırakır (akan düzenleme). */
  const cutSelection = () => {
    if (!selection) return
    const at = selection.start
    removeSelection()
    seek(at)
  }

  // Segmentler arasındaki boşluklar = çıkarılmış aralıklar.
  const gaps = gapsOf(segments, trim)
  // In/Out seçimi dışa aktarımı sınırlar: süre = seçim ∩ parçalar.
  const pieces = segments
    .map((segment) => ({
      start: Math.max(segment.start, trim.start),
      end: Math.min(segment.end, trim.end),
      speed: segment.speed > 0 ? segment.speed : 1,
    }))
    .filter((piece) => piece.end - piece.start > 0.001)
  const kept = pieces.reduce(
    (total, piece) => total + Math.max(0, piece.end - piece.start),
    0,
  )
  const output = pieces.reduce(
    (total, piece) => total + Math.max(0, piece.end - piece.start) / piece.speed,
    0,
  )
  const empty = pieces.length === 0
  const invalid = isLive || empty

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
          disabled={isLive}
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
          disabled={isLive}
        />
      </label>

      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="xs"
          variant="secondary"
          data-slot="cut-selection"
          disabled={isLive || !selection}
          onClick={cutSelection}
          title={selection ? t("trim.cutSelectionTitle") : t("trim.cutHint")}
        >
          <ScissorsIcon />
          {t("trim.cutSelection")}
        </Button>
        {!selection && gaps.length === 0 && !isLive && (
          <span className="text-[11px] text-muted-foreground">{t("trim.cutHint")}</span>
        )}
      </div>

      {(gaps.length > 0 || empty) && (
        <div className="flex flex-wrap items-center gap-1.5" data-slot="cut-list">
          {gaps.map((gap) => (
            <span
              key={`gap-${gap.start}`}
              data-slot="cut-chip"
              className="inline-flex items-center gap-1 rounded-full border border-red-400/50 bg-red-500/10 py-0.5 pr-1 pl-2 font-mono text-[11px] text-red-700 dark:text-red-300"
            >
              <span>
                {formatTime(gap.start, true)}–{formatTime(gap.end, true)}
              </span>
              <button
                type="button"
                aria-label={t("trim.restoreCutAria", {
                  start: formatTime(gap.start, true),
                  end: formatTime(gap.end, true),
                })}
                title={t("trim.restoreCut")}
                onClick={() => restoreRange(gap)}
                className="rounded-full p-0.5 transition-colors hover:bg-red-500/25 focus-visible:bg-red-500/25"
              >
                <PlusIcon className="size-3" />
              </button>
            </span>
          ))}
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={resetSegments}
            title={t("trim.restoreAllTitle")}
          >
            <RotateCcwIcon />
            {t("trim.restoreAll")}
          </Button>
        </div>
      )}

      <span
        data-slot="selection-duration"
        title={
          gaps.length > 0
            ? t("trim.keptTitle", {
                kept: formatTime(Math.max(0, kept), true),
                removed: formatTime(Math.max(0, trim.end - trim.start - kept), true),
              })
            : formatTime(Math.max(0, output), true)
        }
        className={cn(
          "ml-auto flex items-center gap-1.5 font-mono text-xs",
          invalid ? "text-destructive" : "text-muted-foreground",
        )}
      >
        <ScissorsIcon className="size-3.5" />
        {isLive ? t("source.live") : compactDuration(Math.max(0, output))}
        {!isLive && pieces.length > 1 && (
          <span className="font-sans text-muted-foreground/80">
            · {t("trim.pieceCount", { count: pieces.length })}
          </span>
        )}
        {invalid && <span className="font-sans">· {t("trim.invalidWindow")}</span>}
      </span>
    </div>
  )
}
