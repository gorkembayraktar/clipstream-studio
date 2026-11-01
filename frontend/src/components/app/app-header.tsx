/** Üst çubuk: logo, dosya menüsü, proje başlığı ve hızlı eylemler. */
import { useRef, useState } from "react"

import {
  FilePlus2Icon,
  HistoryIcon,
  MenuIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
} from "lucide-react"

import { AppMenuItems } from "@/components/app/app-menu-items"
import { ProjectInfoPopover } from "@/components/app/project-info-popover"
import { ProjectTitleField } from "@/components/app/project-title-field"
import { useProjectWorkspaceController } from "@/components/app/project-workspace-context"
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
import { useProjectUiStore } from "@/stores/project-ui-store"
import { useSourceStore } from "@/stores/source-store"

const RECENT_LIMIT = 5

export function AppHeader() {
  const { t } = useI18n()
  const project = useProjectWorkspaceController()
  const inProject = Boolean(project.projectId)

  const sourceTitle = useSourceStore((s) => s.title)
  const sourceInput = useSourceStore((s) => s.inputUrl)
  const fallbackTitle =
    sourceDisplayName(sourceTitle, sourceInput) ?? t("menu.untitledProject")

  const panelOpen = useProjectUiStore((s) => s.panelOpen)
  const togglePanel = useProjectUiStore((s) => s.togglePanel)
  const requestSourceFocus = useProjectUiStore((s) => s.requestSourceFocus)

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
          title={inProject ? t("menu.homeTitle") : t("app.name")}
          aria-label={inProject ? t("menu.homeTitle") : t("app.name")}
          className="flex shrink-0 items-center rounded-lg p-0.5 transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {/* Sekme ikonu kare kalır; başlıkta arka plansız, renkli marka. */}
          <img
            src="/clipstream-mark-light.svg"
            alt=""
            className="h-7 w-auto dark:hidden"
          />
          <img
            src="/clipstream-mark-dark.svg"
            alt=""
            className="hidden h-7 w-auto dark:block"
          />
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
                      item.title ??
                      sourceDisplayName(
                        item.source?.title,
                        item.source?.inputUrl,
                      ) ??
                      t("menu.untitledProject")
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

            <AppMenuItems />

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
            <ProjectTitleField
              title={project.title}
              fallback={fallbackTitle}
              onRename={project.rename}
            />
            <ProjectInfoPopover />
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
        </div>
      </div>
    </header>
  )
}
