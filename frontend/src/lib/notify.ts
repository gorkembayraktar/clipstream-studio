/** Uygulama bildirimleri: `react-snackbar-glass` üzerine ince bir köprü.
 *
 * Çağrı yerleri `toast.success(mesaj, { description })` imzasını korur; burada
 * ana mesaj cam yüzeyin başlığına, `description` ise gövde metnine dönüşür.
 * Bildirim çağrıları React dışından (store, API istemcisi) da yapılabilsin diye
 * global `toast` kullanılır.
 */
import type { ReactNode } from "react"

import { toast as snackbar } from "react-snackbar-glass"

export interface NotifyAction {
  label: string
  onClick?: () => void | Promise<void>
}

export interface NotifyOptions {
  /** Aynı kimlikle gelen çağrı yeni kart açmaz, var olanı günceller. */
  id?: string
  /** Başlığın altındaki ikincil metin. */
  description?: ReactNode
  /** `Infinity` kalıcı bildirim demektir. */
  duration?: number
  action?: NotifyAction
}

type NotifyVariant = "success" | "error" | "warning" | "info" | "loading"

function toOptions(message: ReactNode, options?: NotifyOptions) {
  const { id, description, duration, action } = options ?? {}

  return {
    id,
    // Tek satırlık bildirimlerde başlık boş kalmasın: açıklama varsa mesaj başlık olur.
    title: description ? message : undefined,
    message: description ?? message,
    duration: duration === Infinity ? null : duration,
    action: action
      ? {
          label: action.label,
          onClick: () => action.onClick?.(),
        }
      : undefined,
  }
}

function preset(variant: NotifyVariant) {
  return (message: ReactNode, options?: NotifyOptions): string =>
    snackbar.show({ ...toOptions(message, options), variant })
}

/** `sonner` benzeri yüzey: mevcut çağrı yerleri değişmeden çalışır. */
export const toast = {
  success: preset("success"),
  error: preset("error"),
  warning: preset("warning"),
  info: preset("info"),
  loading: preset("loading"),
  dismiss: (id?: string): void => snackbar.dismiss(id),
  dismissAll: (): void => snackbar.dismissAll(),
}
