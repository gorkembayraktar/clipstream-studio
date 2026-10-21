/** Alt bilgi tercihleri: dil seçimi ve tema düğmesi birlikte. */
import { LanguagesIcon, MoonIcon, SunIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { LOCALE_OPTIONS, useI18n, type Locale } from "@/i18n"
import { useThemeStore } from "@/stores/theme-store"

export function PreferencesSwitcher() {
  const { locale, setLocale, t } = useI18n()
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/20 p-0.5">
      <LanguagesIcon className="ml-1 size-3.5 text-muted-foreground" aria-hidden />
      <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
        <SelectTrigger
          size="sm"
          className="h-6 w-[104px] border-0 bg-transparent px-1.5 text-[11px] shadow-none focus-visible:ring-1 dark:bg-transparent dark:hover:bg-muted/50"
          aria-label={t("language.switch")}
          title={t("language.switch")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="end" className="min-w-[120px]">
          {LOCALE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value} className="text-xs">
              {t(option.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="h-4 w-px bg-border" aria-hidden />
      <Button
        variant="ghost"
        size="icon-xs"
        className="size-6"
        onClick={toggleTheme}
        data-slot="theme-toggle"
        aria-label={theme === "dark" ? t("player.themeLight") : t("player.themeDark")}
        title={theme === "dark" ? t("player.themeLight") : t("player.themeDark")}
      >
        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      </Button>
    </div>
  )
}
