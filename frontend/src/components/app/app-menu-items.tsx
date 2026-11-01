/** Menüdeki uygulama düzeyi maddeler: ayarlar, hakkında, günlük, dil, tema.
 *
 * Üst çubuktaki dosya menüsünde ve ana sayfadaki ⋮ menüsünde ortaktır; böylece
 * aynı girişler iki yerde ayrı ayrı yazılmaz. Bir `DropdownMenuContent` içinde
 * kullanılmalıdır.
 */
import {
  CheckIcon,
  InfoIcon,
  LanguagesIcon,
  MoonIcon,
  SettingsIcon,
  SunIcon,
  TerminalIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import { useI18n } from "@/i18n"
import { useLogStore } from "@/stores/log-store"
import { useProjectUiStore } from "@/stores/project-ui-store"
import { useThemeStore } from "@/stores/theme-store"

export function AppMenuItems() {
  const { t, locale, setLocale } = useI18n()
  const setSettingsOpen = useProjectUiStore((s) => s.setSettingsOpen)

  const toggleLogs = useLogStore((s) => s.toggle)
  const logsOpen = useLogStore((s) => s.open)
  const errorCount = useLogStore((s) => s.errorCount)

  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  return (
    <>
      <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
        <SettingsIcon />
        {t("menu.settings")}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setSettingsOpen(true, "about")}>
        <InfoIcon />
        {t("menu.about")}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={toggleLogs}>
        <TerminalIcon />
        {logsOpen ? t("menu.hideLogs") : t("menu.showLogs")}
        {errorCount > 0 && (
          <Badge
            variant="destructive"
            className="ml-auto h-4 min-w-4 justify-center px-1 font-mono text-[9px] tabular-nums"
          >
            {errorCount > 9 ? "9+" : errorCount}
          </Badge>
        )}
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <LanguagesIcon />
          {t("menu.language")}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem onSelect={() => setLocale("tr")}>
            {locale === "tr" ? <CheckIcon /> : <span className="size-3.5" />}
            Türkçe
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setLocale("en")}>
            {locale === "en" ? <CheckIcon /> : <span className="size-3.5" />}
            English
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          {theme === "dark" ? <MoonIcon /> : <SunIcon />}
          {t("menu.theme")}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem onSelect={() => setTheme("dark")}>
            {theme === "dark" ? <CheckIcon /> : <span className="size-3.5" />}
            <MoonIcon />
            {t("menu.themeDark")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTheme("light")}>
            {theme === "light" ? <CheckIcon /> : <span className="size-3.5" />}
            <SunIcon />
            {t("menu.themeLight")}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  )
}
