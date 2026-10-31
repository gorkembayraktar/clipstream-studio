/** Oturum başlatma splash ekranı: "video hazırlanıyor" bekleme yüzeyi.
 *
 * Logo kaymasız hâlinden deprem gibi titreyip mevcut markaya kayar; kaynak
 * çözümlenirken ilerleme, aşama ve iptal sunulur. Kısa süreli açılışlarda
 * animasyonun görünmesi için en az `MIN_VISIBLE_MS` ekranda kalır.
 */
import { useEffect, useRef, useState } from "react"

import { SplashBody } from "@/components/app/splash-body"
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

  const stageLabel =
    stage === "downloading"
      ? t("source.downloadingTiktok")
      : stage === "transcoding"
        ? t("source.preparingBrowser")
        : t("source.resolving")

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

      <SplashBody
        title={t("splash.preparing")}
        caption={detail || stageLabel}
        progress={progress}
        onCancel={cancel ?? undefined}
        cancelLabel={t("common.cancel")}
      />
    </div>
  )
}
