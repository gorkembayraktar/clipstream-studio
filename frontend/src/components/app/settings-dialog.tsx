/** Ayarlar penceresi: üst menüden açılır, sol gezinme + sağ içerik düzeninde. */
import {
  AudioWaveformIcon,
  ClapperboardIcon,
  InfoIcon,
  KeyboardIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  TerminalIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"

import { SettingsPanel } from "@/components/app/settings-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { useI18n, type TranslationKey } from "@/i18n"
import { APP_VERSION } from "@/lib/app-version"
import { cn } from "cn"
import {
  useProjectUiStore,
  type SettingsSection,
} from "@/stores/project-ui-store"

const NAV: Array<{
  id: SettingsSection
  labelKey: TranslationKey
  descriptionKey: TranslationKey
  icon: LucideIcon
}> = [
  {
    id: "general",
    labelKey: "settings.nav.general",
    descriptionKey: "settings.desc.general",
    icon: SlidersHorizontalIcon,
  },
  {
    id: "playback",
    labelKey: "settings.nav.playback",
    descriptionKey: "settings.desc.playback",
    icon: AudioWaveformIcon,
  },
  {
    id: "logs",
    labelKey: "settings.nav.logs",
    descriptionKey: "settings.desc.logs",
    icon: TerminalIcon,
  },
  {
    id: "shortcuts",
    labelKey: "settings.nav.shortcuts",
    descriptionKey: "settings.desc.shortcuts",
    icon: KeyboardIcon,
  },
  {
    id: "about",
    labelKey: "settings.nav.about",
    descriptionKey: "settings.desc.about",
    icon: InfoIcon,
  },
]

export function SettingsDialog() {
  const { t } = useI18n()
  const open = useProjectUiStore((s) => s.settingsOpen)
  const setOpen = useProjectUiStore((s) => s.setSettingsOpen)
  const section = useProjectUiStore((s) => s.settingsSection)
  const setSection = useProjectUiStore((s) => s.setSettingsSection)

  const active = NAV.find((item) => item.id === section) ?? NAV[0]

  return (
    <Dialog open={open} onOpenChange={(next) => setOpen(next)}>
      <DialogContent
        showCloseButton={false}
        className="h-[min(82vh,640px)] grid-cols-1 gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        <div className="flex h-full min-h-0 flex-col sm:flex-row">
          <aside
            data-slot="settings-nav"
            className="flex shrink-0 flex-col border-b border-border/60 bg-muted/25 sm:w-56 sm:border-r sm:border-b-0"
          >
            <div className="hidden items-center gap-2 px-3 py-3.5 sm:flex">
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary/12 text-primary">
                <SettingsIcon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <DialogTitle className="truncate text-xs font-semibold">
                  {t("menu.settings")}
                </DialogTitle>
                <p className="text-[10px] text-muted-foreground tabular-nums">
                  ClipStream · v{APP_VERSION}
                </p>
              </div>
            </div>

            <nav
              aria-label={t("menu.settings")}
              className="flex gap-1 overflow-x-auto p-2 sm:flex-col sm:overflow-visible sm:px-2 sm:pb-2"
            >
              {NAV.map(({ id, labelKey, icon: Icon }) => {
                const selected = id === section
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSection(id)}
                    aria-current={selected ? "page" : undefined}
                    className={cn(
                      "flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                      selected
                        ? "bg-background text-foreground shadow-xs ring-1 ring-foreground/10"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-3.5 shrink-0",
                        selected ? "text-primary" : "text-muted-foreground",
                      )}
                      aria-hidden
                    />
                    <span className="truncate">{t(labelKey)}</span>
                  </button>
                )
              })}
            </nav>

            <div className="mt-auto hidden border-t border-border/60 px-3 py-2.5 sm:block">
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {t("settings.appliesImmediately")}
              </p>
            </div>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
              <div className="min-w-0 space-y-0.5">
                <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                  {t(active.labelKey)}
                  {active.id === "about" && (
                    <Badge
                      variant="secondary"
                      className="h-5 px-1.5 font-mono text-[10px]"
                    >
                      v{APP_VERSION}
                    </Badge>
                  )}
                </h2>
                <DialogDescription className="text-[11px] leading-relaxed">
                  {t(active.descriptionKey)}
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground"
                  title={t("common.close")}
                  aria-label={t("common.close")}
                >
                  <XIcon />
                </Button>
              </DialogClose>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <SettingsPanel section={section} />
            </div>

            <footer className="flex items-center justify-between gap-2 border-t border-border/60 px-4 py-2 sm:hidden">
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <ClapperboardIcon className="size-3" aria-hidden />
                ClipStream Studio
              </span>
              <DialogClose asChild>
                <Button variant="outline" size="xs" className="h-7 text-[11px]">
                  {t("common.close")}
                </Button>
              </DialogClose>
            </footer>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
