/** Ayarlar penceresinin bölüm içerikleri: tercihler, oynatma, günlük, kısayollar, hakkında. */
import { useMemo, useState, type ReactElement, type ReactNode } from "react"

import {
  AudioWaveformIcon,
  ClapperboardIcon,
  EraserIcon,
  KeyboardIcon,
  LanguagesIcon,
  MoonIcon,
  SearchIcon,
  SunIcon,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react"

import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { LOCALE_OPTIONS, useI18n, type Locale } from "@/i18n"
import { APP_VERSION } from "@/lib/app-version"
import { KEYBOARD_SHORTCUTS } from "@/lib/keyboard-shortcuts"
import { useLogStore } from "@/stores/log-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import type { SettingsSection } from "@/stores/project-ui-store"
import { useThemeStore } from "@/stores/theme-store"

/** Satır: solda simge + başlık/açıklama, sağda denetim. */
function SettingRow({
  icon: Icon,
  title,
  hint,
  children,
  className,
}: {
  icon?: LucideIcon
  title: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="settings-row"
      className={cn(
        "flex items-center justify-between gap-4 px-3 py-3 transition-colors hover:bg-muted/20",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon && (
          <Icon
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        )}
        <div className="min-w-0 space-y-0.5">
          <div className="text-xs font-medium text-foreground">{title}</div>
          {hint && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {hint}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

function SectionCard({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "divide-y divide-border/60 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10",
        className,
      )}
    >
      {children}
    </div>
  )
}

function GeneralSection() {
  const { t, locale, setLocale } = useI18n()
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  return (
    <SectionCard>
      <SettingRow
        icon={LanguagesIcon}
        title={t("settings.language")}
        hint={t("settings.languageHint")}
      >
        <Select
          value={locale}
          onValueChange={(value) => setLocale(value as Locale)}
        >
          <SelectTrigger
            size="sm"
            className="h-8 w-[148px] text-xs"
            aria-label={t("language.switch")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end" className="min-w-[148px]">
            {LOCALE_OPTIONS.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className="text-xs"
              >
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow
        icon={theme === "dark" ? MoonIcon : SunIcon}
        title={t("settings.theme")}
        hint={t("settings.themeHint")}
      >
        <div className="inline-flex rounded-lg border bg-muted/30 p-0.5">
          <Button
            type="button"
            variant={theme === "light" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-[11px]"
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
            className="h-7 gap-1.5 px-2.5 text-[11px]"
            onClick={() => setTheme("dark")}
            aria-pressed={theme === "dark"}
          >
            <MoonIcon className="size-3.5" aria-hidden />
            {t("settings.themeDark")}
          </Button>
        </div>
      </SettingRow>
    </SectionCard>
  )
}

function PlaybackSection() {
  const { t } = useI18n()
  const waveformEnabled = usePreferencesStore((s) => s.waveformEnabled)
  const setWaveformEnabled = usePreferencesStore((s) => s.setWaveformEnabled)

  return (
    <SectionCard>
      <SettingRow
        icon={AudioWaveformIcon}
        title={t("settings.waveformEnabled")}
        hint={t("settings.waveformEnabledHint")}
      >
        <Switch
          checked={waveformEnabled}
          onCheckedChange={setWaveformEnabled}
          aria-label={t("settings.waveformEnabled")}
        />
      </SettingRow>
    </SectionCard>
  )
}

function LogsSection() {
  const { t } = useI18n()
  const showLogs = useLogStore((s) => s.showLogs)
  const setShowLogs = useLogStore((s) => s.setShowLogs)
  const setOpen = useLogStore((s) => s.setOpen)
  const clear = useLogStore((s) => s.clear)
  const total = useLogStore((s) => s.entries.length)
  const errors = useLogStore((s) => s.errorCount)

  return (
    <div className="space-y-3">
      <SectionCard>
        <SettingRow
          icon={TerminalIcon}
          title={t("settings.showErrorLog")}
          hint={t("settings.showErrorLogHint")}
        >
          <Switch
            checked={showLogs}
            onCheckedChange={setShowLogs}
            aria-label={t("settings.showErrorLog")}
          />
        </SettingRow>
      </SectionCard>

      {showLogs ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
            className="h-8 gap-1.5 text-xs"
          >
            <TerminalIcon className="size-3.5" aria-hidden />
            {t("settings.openLog")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={clear}
            className="h-8 gap-1.5 text-xs"
          >
            <EraserIcon className="size-3.5" aria-hidden />
            {t("settings.clearLog")}
          </Button>
          <div className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Badge variant="secondary" className="h-5 px-1.5 font-mono text-[10px]">
              {total}
            </Badge>
            <span>{t("settings.logEntries")}</span>
            {errors > 0 && (
              <Badge
                variant="destructive"
                className="h-5 px-1.5 font-mono text-[10px]"
              >
                {errors}
              </Badge>
            )}
          </div>
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t("settings.logsHiddenHint")}
        </p>
      )}
    </div>
  )
}

function ShortcutsSection() {
  const { t } = useI18n()
  const [query, setQuery] = useState("")

  const shortcuts = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return KEYBOARD_SHORTCUTS
    return KEYBOARD_SHORTCUTS.filter((shortcut) =>
      t(shortcut.labelKey).toLocaleLowerCase().includes(needle),
    )
  }, [query, t])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("settings.shortcutsSearch")}
            aria-label={t("settings.shortcutsSearch")}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {shortcuts.length}/{KEYBOARD_SHORTCUTS.length}
        </span>
      </div>

      <SectionCard className="max-h-[46vh] overflow-y-auto">
        {shortcuts.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">
            {t("settings.shortcutsEmpty")}
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {shortcuts.map((shortcut) => (
              <li
                key={shortcut.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {t(shortcut.labelKey)}
                </span>
                <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                  {shortcut.keys.map((key) => (
                    <kbd
                      key={`${shortcut.id}-${key}`}
                      className="rounded-md border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] leading-none text-foreground shadow-xs"
                    >
                      {key}
                    </kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <p className="text-[11px] text-muted-foreground">
        {t("settings.shortcutsHint")}
      </p>
    </div>
  )
}

function AboutSection() {
  const { t } = useI18n()

  return (
    <div className="space-y-3">
      <SectionCard>
        <div className="flex items-start gap-3 px-3 py-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <ClapperboardIcon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold tracking-tight">
                ClipStream Studio
              </h3>
              <Badge variant="secondary" className="h-5 px-1.5 font-mono text-[10px]">
                v{APP_VERSION}
              </Badge>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t("settings.aboutDescription")}
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard>
        <div className="grid grid-cols-2 gap-px bg-border/60">
          {[
            { label: t("settings.aboutRuntime"), value: "Local · 127.0.0.1" },
            { label: t("settings.aboutEngine"), value: "FFmpeg · yt-dlp" },
            { label: t("settings.aboutStorage"), value: "localStorage" },
            { label: t("settings.aboutLicense"), value: "Private" },
          ].map((item) => (
            <div key={item.label} className="bg-card px-3 py-2.5">
              <div className="text-[10px] tracking-wide text-muted-foreground uppercase">
                {item.label}
              </div>
              <div className="mt-0.5 text-xs font-medium">{item.value}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <KeyboardIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t("settings.aboutLocal")}
      </p>
    </div>
  )
}

const SECTIONS: Record<SettingsSection, () => ReactElement> = {
  general: GeneralSection,
  playback: PlaybackSection,
  logs: LogsSection,
  shortcuts: ShortcutsSection,
  about: AboutSection,
}

export function SettingsPanel({ section }: { section: SettingsSection }) {
  const Content = SECTIONS[section] ?? GeneralSection
  return (
    <div data-slot="settings-section-content" className="animate-in fade-in-0 duration-150">
      <Content />
    </div>
  )
}
