/** Üst çubuk: logo, dosya menüsü, proje başlığı ve hızlı eylemler. */
import { useRef, useState } from "react"

import {
  CheckIcon,
  Clapperboard,
  FilePlus2Icon,
  HistoryIcon,
  InfoIcon,
  LanguagesIcon,
  MenuIcon,
  MoonIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  SettingsIcon,
  SunIcon,
  TerminalIcon,
} from "lucide-react"

import { useProjectWorkspaceController } from "@/components/app/project-workspace-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { APP_VERSION } from "@/lib/app-version"
import { formatRelativeTime, sourceDisplayName } from "@/lib/format"
import { projectUrl } from "@/lib/project-route"
import { listProjectWorkspaces } from "@/lib/project-workspace"
import { useI18n } from "@/i18n"
import { useLogStore } from "@/stores/log-store"
import { useProjectUiStore } from "@/stores/project-ui-store"
import { useSourceStore } from "@/stores/source-store"
import { useThemeStore } from "@/stores/theme-store"

const RECENT_LIMIT = 5

export function AppHeader() {
  const { t, locale, setLocale } = useI18n()
  const project = useProjectWorkspaceController()
  const inProject = Boolean(project.projectId)

  const sourceTitle = useSourceStore((s) => s.title)
  const sourceInput = useSourceStore((s) => s.inputUrl)
  const headerTitle =
    project.title ||
    sourceDisplayName(sourceTitle, sourceInput) ||
    t("menu.untitledProject")

  const panelOpen = useProjectUiStore((s) => s.panelOpen)
  const togglePanel = useProjectUiStore((s) => s.togglePanel)
  const setSettingsOpen = useProjectUiStore((s) => s.setSettingsOpen)
  const requestSourceFocus = useProjectUiStore((s) => s.requestSourceFocus)

  const toggleLogs = useLogStore((s) => s.toggle)
  const logsOpen = useLogStore((s) => s.open)
  const showLogs = useLogStore((s) => s.showLogs)
  const errorCount = useLogStore((s) => s.errorCount)

  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  const [recentProjects, setRecentProjects] = useState(() =>
    listProjectWorkspaces().slice(0, RECENT_LIMIT),
  )

  /** Menü açılırken listeyi tazele: localStorage her render'da okunmaz. */
  const handleMenuOpenChange = (open: boolean) => {
    if (open) setRecentProjects(listProjectWorkspaces().slice(0, RECENT_LIMIT))
  }

  /** Menü kapanırken odağın tetikleyiciye dönmesini engellemek için. */
  const keepFocusRef = useRef(false)

  /** Yeni proje: projeden çık, ana sayfadaki kaynak alanına odaklan. */
  const startNewProject = () => {
    if (inProject) project.goHome()
    keepFocusRef.current = true
    window.setTimeout(requestSourceFocus, 0)
  }

  /** Son projeyi aç: önce mevcut projeyi kaydet, sonra tam sayfa yükle. */
  const openRecent = (id: string) => {
    if (inProject) project.goHome()
    window.location.assign(projectUrl(id))
  }

  return (
    <header
      data-slot="app-header"
      className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl"
    >
      <div className="flex h-12 items-center gap-1.5 px-2.5 sm:px-3">
        <button
          type="button"
          onClick={inProject ? project.goHome : undefined}
          title={inProject ? t("menu.homeTitle") : t("menu.title")}
          className="flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary/12 text-primary">
            <Clapperboard className="size-4" />
          </span>
          <span className="hidden text-sm font-semibold tracking-tight sm:block">
            ClipStream
          </span>
        </button>

        <DropdownMenu onOpenChange={handleMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-muted-foreground"
              title={t("menu.title")}
              aria-label={t("menu.title")}
            >
              <MenuIcon className="size-4" />
              <span className="hidden text-xs sm:block">{t("menu.file")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-60"
            onCloseAutoFocus={(event) => {
              if (!keepFocusRef.current) return
              keepFocusRef.current = false
              event.preventDefault()
            }}
          >
            <DropdownMenuLabel className="text-[10px] tracking-wider text-muted-foreground uppercase">
              {t("menu.projectSection")}
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={startNewProject}>
              <FilePlus2Icon />
              <span className="min-w-0 flex-1 truncate">
                {t("project.newProject")}
              </span>
            </DropdownMenuItem>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={recentProjects.length === 0}>
                <HistoryIcon />
                <span className="min-w-0 flex-1 truncate">
                  {t("menu.recentProjects")}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-64">
                {recentProjects.length === 0 ? (
                  <DropdownMenuItem disabled>
                    {t("menu.noRecentProjects")}
                  </DropdownMenuItem>
                ) : (
                  recentProjects.map((item) => {
                    const name =
                      sourceDisplayName(
                        item.source?.title,
                        item.source?.inputUrl,
                      ) ?? t("menu.untitledProject")
                    return (
                      <DropdownMenuItem
                        key={item.id}
                        onSelect={() => openRecent(item.id)}
                        className="gap-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs">{name}</span>
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {formatRelativeTime(item.updated_date / 1000)}
                          </span>
                        </span>
                      </DropdownMenuItem>
                    )
                  })
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />

            <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
              <SettingsIcon />
              {t("menu.settings")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setSettingsOpen(true, "about")}
            >
              <InfoIcon />
              {t("menu.about")}
            </DropdownMenuItem>
            {showLogs && (
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
            )}

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

            <DropdownMenuSeparator />
            <p className="px-2 py-1.5 text-[10px] text-muted-foreground tabular-nums">
              ClipStream Studio · v{APP_VERSION}
            </p>
          </DropdownMenuContent>
        </DropdownMenu>

        {inProject && (
          <div className="ml-1 flex min-w-0 items-center gap-2 border-l border-border/60 pl-2">
            <span
              className="size-1.5 shrink-0 rounded-full bg-emerald-500"
              aria-hidden
            />
            <span
              className="max-w-[38vw] truncate text-xs font-medium text-foreground/90"
              title={headerTitle}
            >
              {headerTitle}
            </span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          {inProject && (
            <Button
              variant={panelOpen ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={togglePanel}
              title={panelOpen ? t("menu.hidePanel") : t("menu.showPanel")}
              aria-label={panelOpen ? t("menu.hidePanel") : t("menu.showPanel")}
              aria-pressed={panelOpen}
            >
              {panelOpen ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
            </Button>
          )}

          {showLogs && (
            <Button
              variant={logsOpen ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={toggleLogs}
              title={logsOpen ? t("menu.hideLogs") : t("menu.showLogs")}
              aria-label={logsOpen ? t("menu.hideLogs") : t("menu.showLogs")}
              className="relative"
            >
              <TerminalIcon />
              {errorCount > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -top-1 -right-1 h-4 min-w-4 justify-center px-1 font-mono text-[9px] tabular-nums"
                >
                  {errorCount > 9 ? "9+" : errorCount}
                </Badge>
              )}
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSettingsOpen(true)}
            title={t("menu.settings")}
            aria-label={t("menu.settings")}
          >
            <SettingsIcon />
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title={t("menu.themeToggle")}
            aria-label={t("menu.themeToggle")}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </Button>
        </div>
      </div>
    </header>
  )
}
