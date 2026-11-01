/** Günlük penceresi: sistem & hata kayıtları modal olarak açılır.
 *
 * Alt çekmece yerine Radix Dialog kullanılır; böylece sahnenin altında kalıcı
 * bir şerit yer kaplamaz ve yalnızca açıldığında görünür. Kopyala / Temizle
 * işlemleri pencerenin alt şeridindedir.
 */
import { useEffect, useRef } from "react"

import { TerminalIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "cn"
import { useI18n, type TranslationKey } from "@/i18n"
import { useLogStore, type LogLevel } from "@/stores/log-store"

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

export function LogDialog() {
  const { t } = useI18n()
  const entries = useLogStore((s) => s.entries)
  const errorCount = useLogStore((s) => s.errorCount)
  const open = useLogStore((s) => s.open)
  const setOpen = useLogStore((s) => s.setOpen)
  const log = useLogStore((s) => s.log)
  const clear = useLogStore((s) => s.clear)

  const bodyRef = useRef<HTMLDivElement>(null)

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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        data-slot="log-dialog"
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        <DialogHeader className="flex-row items-center gap-2 border-b border-border/60 py-2.5 pr-10 pl-4">
          <TerminalIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <DialogTitle className="text-sm">{t("logs.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("logs.title")}</DialogDescription>
          <Badge
            variant={errorCount > 0 ? "destructive" : "secondary"}
            className="ml-auto shrink-0 font-mono text-[10px]"
          >
            {errorCount > 0
              ? t("logs.errorsAndTotal", { errors: errorCount, total: entries.length })
              : t("logs.total", { total: entries.length })}
          </Badge>
        </DialogHeader>

        <div
          ref={bodyRef}
          data-slot="log-terminal"
          className="min-h-0 flex-1 overflow-y-auto bg-muted/60 px-4 py-2 font-mono text-[11px] leading-relaxed dark:bg-black/40"
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

        <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2">
          <Button variant="ghost" size="xs" onClick={() => void copyLogs()}>
            {t("logs.copy")}
          </Button>
          <Button variant="ghost" size="xs" onClick={clear}>
            {t("logs.clear")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
