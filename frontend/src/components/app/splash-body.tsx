/** Yükleme yüzeylerinin ortak gövdesi: animasyonlu marka, başlık, ilerleme.
 *
 * Hem oturum başlatma splash'ı hem de proje geri yükleme ekranı aynı görsel
 * dili paylaşsın diye tek yerde tutulur. Dış kabuk (tam ekran ya da kart)
 * çağıran bileşene aittir.
 */
import type { ReactNode } from "react"

import { SplashMark } from "@/components/app/splash-mark"
import { Button } from "@/components/ui/button"

interface SplashBodyProps {
  title: ReactNode
  subtitle?: ReactNode
  caption?: ReactNode
  detail?: string
  /** 0-100 arası yüzde; `null` belirsiz ilerleme. */
  progress: number | null
  markClassName?: string
  onCancel?: () => void
  cancelLabel?: string
}

export function SplashBody({
  title,
  subtitle,
  caption,
  detail,
  progress,
  markClassName = "h-24 w-auto",
  onCancel,
  cancelLabel,
}: SplashBodyProps) {
  const percent =
    progress === null ? null : Math.max(0, Math.min(100, Math.round(progress)))

  return (
    <div className="relative flex flex-col items-center gap-5">
      <SplashMark className={`splash-mark ${markClassName}`} />

      <div className="space-y-1.5 text-center">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {subtitle && (
          <p className="max-w-xs truncate text-sm font-medium" title={String(subtitle)}>
            {subtitle}
          </p>
        )}
        {caption && (
          <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
            {caption}
          </p>
        )}
        {detail && (
          <p
            className="max-w-xs truncate text-[11px] text-muted-foreground/80"
            title={detail}
          >
            {detail}
          </p>
        )}
      </div>

      <div className="w-56 space-y-1.5">
        <div
          className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={String(title)}
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

      {onCancel && cancelLabel && (
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {cancelLabel}
        </Button>
      )}
    </div>
  )
}
