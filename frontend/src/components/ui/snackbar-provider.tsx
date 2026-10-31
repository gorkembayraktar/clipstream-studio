/** Bildirim yuvası: `react-snackbar-glass` sağlayıcısını uygulamaya bağlar.
 *
 * Tema mağazasıyla senkron kalır, cam yüzeyi uygulamanın yarıçap ve yazı tipi
 * jetonlarına uyarlar; kapatma ve bölge etiketleri i18n üzerinden gelir.
 */
import type { CSSProperties, ReactNode } from "react"

import { SnackbarProvider } from "react-snackbar-glass"

import { useI18n } from "@/i18n"
import { useThemeStore } from "@/stores/theme-store"

const HOST_STYLE = {
  "--prs-font": "var(--font-sans)",
  "--prs-radius": "calc(var(--radius) * 1.4)",
} as CSSProperties

export function AppSnackbarProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const theme = useThemeStore((s) => s.theme)

  return (
    <SnackbarProvider
      position="top-right"
      offset={56}
      duration={4200}
      maxVisible={3}
      tone="glass"
      theme={theme}
      closeLabel={t("notify.dismiss")}
      regionLabel={t("notify.region")}
      minimizedLabel={(count) => t("notify.minimized", { count })}
      style={HOST_STYLE}
    >
      {children}
    </SnackbarProvider>
  )
}
