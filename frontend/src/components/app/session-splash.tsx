/** Oturum başlatma splash ekranı: "video hazırlanıyor" bekleme yüzeyi.
 *
 * Logo kaymasız hâlinden deprem gibi titreyip mevcut markaya kayar; kaynak
 * çözümlenirken ilerleme, aşama ve iptal sunulur. Kısa süreli açılışlarda
 * animasyonun görünmesi için en az `MIN_VISIBLE_MS` ekranda kalır.
 */
import { useEffect, useRef, useState } from "react"

import { SplashMark } from "@/components/app/splash-mark"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/i18n"
import { useSessionSplashStore } from "@/stores/session-splash-store"

const MIN_VISIBLE_MS = 900

export function SessionSplash() {
  const { t } = useI18n()
  const open = useSessionSplashStore((s) => s.open)
  const progress = useSessionSplashStore((s) => s.progress)
  const stage = useSessionSplashStore((s) => s.stage)
  const detail = useSessionSplashStore((s) => s.detail)
  const cancel = useSessionSplashStore((s) => s.cancel)

  const [visible, setVisible] = useState(false)
  const shownAt = useRef(0)

  useEffect(() => {
    if (open) {
      shownAt.current = performance.now()
      setVisible(true)
      return
    }

    const remaining = Math.max(
      0,
      MIN_VISIBLE_MS - (performance.now() - shownAt.current),
    )
    const timer = window.setTimeout(() => setVisible(false), remaining)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!visible || !cancel) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [visible, cancel])

  if (!visible) return null

  const percent =
    progress === null ? null : Math.max(0, Math.min(100, Math.round(progress)))
  const stageLabel =
    stage === "downloading"
      ? t("source.downloadingTiktok")
      : stage === "transcoding"
        ? t("source.preparingBrowser")
        : t("source.resolving")
  const caption = detail || stageLabel

  return (
    <div
      data-slot="session-splash"
      role="status"
      aria-live="polite"
      aria-busy
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-background/85 px-6 backdrop-blur-2xl"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 size-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl" />
      </div>

      <div className="relative flex flex-col items-center gap-5">
        <SplashMark className="splash-mark h-24 w-auto" />

        <div className="space-y-1.5 text-center">
          <h1 className="text-lg font-semibold tracking-tight">
            {t("splash.preparing")}
          </h1>
          <p
            className="max-w-xs truncate text-xs text-muted-foreground"
            title={detail || undefined}
          >
            {caption}
          </p>
        </div>

        <div className="w-56 space-y-1.5">
          <div
            className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={t("splash.preparing")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
          >
            {percent === null ? (
              <div className="absolute inset-y-0 left-0 w-1/3 animate-[project-loading-bar_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
            ) : (
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: `${percent}%` }}
              />
            )}
          </div>

          <p
            className="h-3 text-center font-mono text-[10px] tabular-nums text-muted-foreground"
            aria-hidden={percent === null}
          >
            {percent === null ? "\u00a0" : `${percent}%`}
          </p>
        </div>

        {cancel && (
          <Button type="button" variant="ghost" size="sm" onClick={cancel}>
            {t("common.cancel")}
          </Button>
        )}
      </div>
    </div>
  )
}
