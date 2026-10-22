/** Ayarlar sekmesi: başlığın altında açılan dikey bölümler, dil/tema, log ve kısayollar. */
import { useEffect, useState } from "react"

import {
  ChevronDownIcon,
  KeyboardIcon,
  LanguagesIcon,
  MoonIcon,
  SlidersHorizontalIcon,
  SunIcon,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react"

import { cn } from "cn"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { LOCALE_OPTIONS, useI18n, type Locale, type TranslationKey } from "@/i18n"
import { KEYBOARD_SHORTCUTS } from "@/lib/keyboard-shortcuts"
import { useLogStore } from "@/stores/log-store"
import { useThemeStore } from "@/stores/theme-store"

type SettingsTabId = "preferences" | "logs" | "shortcuts"
type OpenSettingsTabs = Record<SettingsTabId, boolean>

const SETTINGS_TABS_STORAGE_KEY = "clip2:settings-open-tabs"

const DEFAULT_OPEN_TABS: OpenSettingsTabs = {
  preferences: true,
  logs: false,
  shortcuts: false,
}

const SETTINGS_TABS: Array<{
  id: SettingsTabId
  labelKey: TranslationKey
  icon: LucideIcon
}> = [
  { id: "preferences", labelKey: "settings.preferences", icon: SlidersHorizontalIcon },
  { id: "logs", labelKey: "settings.logs", icon: TerminalIcon },
  { id: "shortcuts", labelKey: "settings.shortcuts", icon: KeyboardIcon },
]

/** İlk açılışta yalnızca ilk bölüm açıktır; sonrasında her bölümün durumu saklanır. */
function readOpenSettingsTabs(): OpenSettingsTabs {
  if (typeof window === "undefined") return DEFAULT_OPEN_TABS
  try {
    const raw = window.localStorage.getItem(SETTINGS_TABS_STORAGE_KEY)
    if (!raw) return DEFAULT_OPEN_TABS
    const parsed = JSON.parse(raw) as Partial<Record<SettingsTabId, unknown>>
    return {
      preferences: parsed.preferences === true,
      logs: parsed.logs === true,
      shortcuts: parsed.shortcuts === true,
    }
  } catch {
    return DEFAULT_OPEN_TABS
  }
}

function persistOpenSettingsTabs(tabs: OpenSettingsTabs) {
  try {
    window.localStorage.setItem(SETTINGS_TABS_STORAGE_KEY, JSON.stringify(tabs))
  } catch {
    /* gizli sekme vb. durumlarda sessizce yok sayılır */
  }
}

export function SettingsPanel() {
  const { locale, setLocale, t } = useI18n()
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const showLogs = useLogStore((s) => s.showLogs)
  const setShowLogs = useLogStore((s) => s.setShowLogs)
  const [openTabs, setOpenTabs] = useState<OpenSettingsTabs>(readOpenSettingsTabs)

  useEffect(() => {
    persistOpenSettingsTabs(openTabs)
  }, [openTabs])

  const toggleTab = (tab: SettingsTabId) => {
    setOpenTabs((current) => ({ ...current, [tab]: !current[tab] }))
  }

  const renderTabContent = (id: SettingsTabId) => {
    if (id === "preferences") {
      return (
        <div className="divide-y rounded-md border bg-background/40">
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
      )
    }

    if (id === "logs") {
      return (
        <div className="flex items-center justify-between gap-3 rounded-md border bg-background/40 px-3 py-2.5">
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
      )
    }

    return (
      <div className="space-y-2">
        <p className="text-right text-[10px] text-muted-foreground">
          {t("settings.shortcutsHint")}
        </p>

        <div className="overflow-hidden rounded-md border">
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
      </div>
    )
  }

  return (
    <div
      data-slot="settings-accordion"
      className="divide-y overflow-hidden rounded-lg border bg-card"
    >
      {SETTINGS_TABS.map(({ id, labelKey, icon: Icon }) => {
        const open = openTabs[id]
        return (
          <div
            key={id}
            data-slot="settings-section"
            data-state={open ? "open" : "closed"}
            className={cn("transition-colors", open && "bg-muted/10")}
          >
            <button
              type="button"
              id={`settings-tab-${id}`}
              aria-controls={`settings-panel-${id}`}
              aria-expanded={open}
              onClick={() => toggleTab(id)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2.5 text-left text-[11px] font-semibold tracking-wide uppercase transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
                open
                  ? "bg-muted/20 text-foreground"
                  : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
              )}
            >
              <Icon
                className={cn(
                  "size-3.5 shrink-0 transition-colors",
                  open ? "text-foreground" : "text-muted-foreground",
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{t(labelKey)}</span>
              <ChevronDownIcon
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
                  open && "rotate-180",
                )}
                aria-hidden
              />
            </button>

            {open && (
              <div
                id={`settings-panel-${id}`}
                role="region"
                aria-labelledby={`settings-tab-${id}`}
                className="animate-in border-t border-border/70 bg-background/30 px-3 py-3 fade-in-0 slide-in-from-top-1 duration-150"
              >
                {renderTabContent(id)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
