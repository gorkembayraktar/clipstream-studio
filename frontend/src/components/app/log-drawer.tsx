/** Sabit alt günlük çekmecesi: sistem & hata kayıtları, Kopyala / Temizle, üst kenardan boyutlandırma. */
import { useEffect, useRef, useState } from "react"

import { ChevronDownIcon, TerminalIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "cn"
import { useI18n, type TranslationKey } from "@/i18n"
import { clamp } from "@/lib/format"
import { useLogStore, type LogLevel } from "@/stores/log-store"

/** Gövde yüksekliği tarayıcıda saklanır (px). */
const HEIGHT_KEY = "clip2:log-drawer-height"
/** Sürüklemeyle inilebilecek en küçük yükseklik. */
const MIN_HEIGHT = 80
/** Sürüklenmemişken gövde içerikle birlikte en fazla bu kadar uzar. */
const DEFAULT_MAX_HEIGHT = 240
/** Boyutlandırmada pencerenin üstünde her zaman bu kadar boşluk kalır. */
const VIEWPORT_MARGIN = 140
/** Klavye oklarıyla boyut adımı. */
const KEY_STEP = 24

function maxHeight(): number {
  return Math.max(MIN_HEIGHT, window.innerHeight - VIEWPORT_MARGIN)
}

function readHeight(): number | null {
  try {
    const raw = window.localStorage.getItem(HEIGHT_KEY)
    if (!raw) return null
    const value = Number(raw)
    return Number.isFinite(value) ? clamp(Math.round(value), MIN_HEIGHT, maxHeight()) : null
  } catch {
    return null
  }
}

function persistHeight(height: number | null) {
  try {
    if (height === null) window.localStorage.removeItem(HEIGHT_KEY)
    else window.localStorage.setItem(HEIGHT_KEY, String(Math.round(height)))
  } catch {
    /* gizli sekme vb. durumlarda sessizce yok sayılır */
  }
}

/** Pointer yakalama kenar durumlarda (ör. sentetik olaylar) hata verebilir; sürükleme yine de çalışır. */
function capturePointer(element: Element | null, pointerId: number) {
  try {
    element?.setPointerCapture(pointerId)
  } catch {
    /* yok sayılır */
  }
}

function releasePointer(element: Element | null, pointerId: number) {
  try {
    if (element?.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
  } catch {
    /* yok sayılır */
  }
}

const TAG_KEYS: Record<LogLevel, TranslationKey> = {
  info: "logs.tagInfo",
  success: "logs.tagSuccess",
  warn: "logs.tagWarn",
  error: "logs.tagError",
}

const TAG_CLASSES: Record<LogLevel, string> = {
  info: "text-sky-600 dark:text-sky-300",
  success: "text-emerald-600 dark:text-emerald-300",
  warn: "text-amber-600 dark:text-amber-300",
  error: "text-rose-600 dark:text-rose-300",
}

export function LogDrawer() {
  const { t } = useI18n()
  const entries = useLogStore((s) => s.entries)
  const errorCount = useLogStore((s) => s.errorCount)
  const open = useLogStore((s) => s.open)
  const toggle = useLogStore((s) => s.toggle)
  const log = useLogStore((s) => s.log)
  const clear = useLogStore((s) => s.clear)

  const bodyRef = useRef<HTMLDivElement>(null)
  /** Gövde yüksekliği (px); null → içerik kadar (en fazla 240 px). */
  const [height, setHeight] = useState<number | null>(() => readHeight())
  const [resizing, setResizing] = useState(false)
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  /** Sürükleme sırasında son yükseklik (pointerup anında state gecikmesin). */
  const heightRef = useRef<number | null>(height)

  const applyHeight = (next: number | null, persist = false) => {
    heightRef.current = next
    setHeight(next)
    if (persist) persistHeight(next)
  }

  /** Sürükleme başlangıcında gövdenin o anki yüksekliği ölçülür (sıçrama olmasın). */
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    capturePointer(event.currentTarget, event.pointerId)
    dragRef.current = {
      startY: event.clientY,
      startHeight: height ?? (bodyRef.current?.offsetHeight ?? DEFAULT_MAX_HEIGHT),
    }
    setResizing(true)
  }

  /** Yukarı sürükleme büyütür: imleç yukarıdayken fark pozitiftir. */
  const moveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    event.preventDefault()
    applyHeight(clamp(drag.startHeight + (drag.startY - event.clientY), MIN_HEIGHT, maxHeight()))
  }

  const endResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    releasePointer(event.currentTarget, event.pointerId)
    setResizing(false)
    persistHeight(heightRef.current)
  }

  /** Klavye ile boyutlandırma (erişilebilirlik): ↑ büyütür, ↓ küçültür. */
  const onResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
    event.preventDefault()
    const base = height ?? heightRef.current ?? bodyRef.current?.offsetHeight ?? DEFAULT_MAX_HEIGHT
    const delta = event.key === "ArrowUp" ? KEY_STEP : -KEY_STEP
    applyHeight(clamp(base + delta, MIN_HEIGHT, maxHeight()), true)
  }

  /** Çift tıklama varsayılan (içerik kadar) yüksekliğe döndürür. */
  const resetHeight = () => {
    applyHeight(null, true)
    dragRef.current = null
    setResizing(false)
  }

  // Yeni kayıtta en alta kaydır
  useEffect(() => {
    if (!open) return
    const body = bodyRef.current
    if (body) body.scrollTop = body.scrollHeight
  }, [entries, open])

  const copyLogs = async () => {
    const text = entries
      .map(
        (entry) =>
          `[${entry.time}] ${t(TAG_KEYS[entry.level])} ${entry.message}${
            entry.extra ? ` (${entry.extra})` : ""
          }`,
      )
      .join("\n")

    try {
      await navigator.clipboard.writeText(text)
      log("success", t("logs.copied"))
    } catch {
      log("error", t("logs.copyFailed"))
    }
  }

  return (
    <div data-slot="log-drawer" className="fixed inset-x-0 bottom-0 left-0 right-0 z-50">
      <div
        className={cn(
          "overflow-hidden border-t border-border/70 bg-card/95 shadow-2xl backdrop-blur",
          resizing && "select-none",
        )}
      >
        {open && (
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={t("logs.resizeAria")}
            aria-valuenow={height === null ? undefined : Math.round(height)}
            aria-valuemin={MIN_HEIGHT}
            tabIndex={0}
            data-slot="log-resize-handle"
            title={t("logs.resizeTitle")}
            onPointerDown={startResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onDoubleClick={resetHeight}
            onKeyDown={onResizeKeyDown}
            className={cn(
              "group flex h-2 cursor-ns-resize touch-none items-center justify-center outline-none",
              "hover:bg-accent/40 focus-visible:bg-accent/40",
              resizing && "bg-primary/20",
            )}
          >
            <span
              className={cn(
                "h-0.5 w-12 rounded-full transition-colors",
                resizing ? "bg-primary" : "bg-border group-hover:bg-muted-foreground/60",
              )}
            />
          </div>
        )}

        <div className="flex items-center gap-2 px-3 py-1.5">
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              title={open ? t("logs.closeTitle") : t("logs.openTitle")}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
            >
              <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate text-xs font-medium">{t("logs.title")}</span>
              <Badge
                variant={errorCount > 0 ? "destructive" : "secondary"}
                className="shrink-0 font-mono text-[10px]"
              >
                {errorCount > 0
                  ? t("logs.errorsAndTotal", { errors: errorCount, total: entries.length })
                  : t("logs.total", { total: entries.length })}
              </Badge>
            </button>

            {open && (
              <>
                <Button variant="ghost" size="xs" onClick={() => void copyLogs()}>
                  {t("logs.copy")}
                </Button>
                <Button variant="ghost" size="xs" onClick={clear}>
                  {t("logs.clear")}
                </Button>
              </>
            )}

            <Button
              variant="ghost"
              size="icon-xs"
              onClick={toggle}
              title={open ? t("logs.close") : t("logs.open")}
              data-slot="log-drawer-toggle"
            >
              <ChevronDownIcon className={cn("transition-transform", !open && "rotate-180")} />
            </Button>
          </div>

          {open && (
            <div
              ref={bodyRef}
              data-slot="log-terminal"
              style={height === null ? { maxHeight: DEFAULT_MAX_HEIGHT } : { height }}
              className="overflow-y-auto border-t border-border/60 bg-muted/60 px-3 py-2 font-mono text-[11px] leading-relaxed dark:bg-black/40"
            >
              {entries.length === 0 ? (
                <p className="text-muted-foreground">{t("logs.empty")}</p>
              ) : (
                entries.map((entry) => (
                  <div key={entry.id} className="flex flex-wrap gap-x-1.5">
                    <span className="text-muted-foreground">[{entry.time}]</span>
                    <span className={cn("font-semibold", TAG_CLASSES[entry.level])}>
                      {t(TAG_KEYS[entry.level])}
                    </span>
                    <span className="min-w-0 break-words text-foreground/90">
                      {entry.message}
                      {entry.extra && (
                        <span className="text-muted-foreground"> ({entry.extra})</span>
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
      </div>
    </div>
  )
}
