/** Ayarlar sekmesi: dil, tema, log görünürlüğü ve varsayılan klavye kısayolları. */
import { LanguagesIcon, MoonIcon, SunIcon, TerminalIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { LOCALE_OPTIONS, useI18n, type Locale } from "@/i18n"
import { KEYBOARD_SHORTCUTS } from "@/lib/keyboard-shortcuts"
import { useLogStore } from "@/stores/log-store"
import { useThemeStore } from "@/stores/theme-store"

export function SettingsPanel() {
  const { locale, setLocale, t } = useI18n()
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const showLogs = useLogStore((s) => s.showLogs)
  const setShowLogs = useLogStore((s) => s.setShowLogs)

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          {t("settings.preferences")}
        </h3>

        <div className="divide-y rounded-lg border bg-muted/10">
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm">
              <LanguagesIcon className="size-4 text-muted-foreground" aria-hidden />
              <span>{t("settings.language")}</span>
            </div>
            <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
              <SelectTrigger
                size="sm"
                className="h-8 w-[132px] text-xs"
                aria-label={t("language.switch")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end" className="min-w-[132px]">
                {LOCALE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-xs">
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm">
              {theme === "dark" ? (
                <MoonIcon className="size-4 text-muted-foreground" aria-hidden />
              ) : (
                <SunIcon className="size-4 text-muted-foreground" aria-hidden />
              )}
              <span>{t("settings.theme")}</span>
            </div>
            <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
              <Button
                type="button"
                variant={theme === "light" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 gap-1.5 px-2 text-[11px]"
                onClick={() => setTheme("light")}
                aria-pressed={theme === "light"}
              >
                <SunIcon className="size-3.5" aria-hidden />
                {t("settings.themeLight")}
              </Button>
              <Button
                type="button"
                variant={theme === "dark" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 gap-1.5 px-2 text-[11px]"
                onClick={() => setTheme("dark")}
                aria-pressed={theme === "dark"}
              >
                <MoonIcon className="size-3.5" aria-hidden />
                {t("settings.themeDark")}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          {t("settings.logs")}
        </h3>

        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/10 px-3 py-2.5">
          <div className="flex min-w-0 items-start gap-2">
            <TerminalIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <div className="text-sm">{t("settings.showErrorLog")}</div>
              <p className="text-[10px] text-muted-foreground">
                {t("settings.showErrorLogHint")}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {showLogs ? t("settings.yes") : t("settings.no")}
            </span>
            <Switch
              checked={showLogs}
              onCheckedChange={setShowLogs}
              aria-label={t("settings.showErrorLog")}
            />
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <h3 className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            {t("settings.shortcuts")}
          </h3>
          <span className="text-[10px] text-muted-foreground">
            {t("settings.shortcutsHint")}
          </span>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <table className="w-full table-fixed text-xs">
            <thead className="bg-muted/40 text-[10px] tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="w-[58%] px-3 py-2 text-left font-medium">
                  {t("settings.shortcutAction")}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {t("settings.shortcutKeys")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {KEYBOARD_SHORTCUTS.map((shortcut) => (
                <tr key={shortcut.id}>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {t(shortcut.labelKey)}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      {shortcut.keys.map((key) => (
                        <kbd
                          key={`${shortcut.id}-${key}`}
                          className="rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] leading-none text-foreground"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
