/** Kaynak panelinin altında bu tarayıcıda kayıtlı son projeleri gösterir. */
import { useEffect, useRef, useState } from "react"

import { ChevronDown, ExternalLink, History, RefreshCwIcon } from "lucide-react"

import { cn } from "cn"

import { useProjectWorkspaceController } from "@/components/app/project-workspace-context"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/i18n"
import { projectUrl } from "@/lib/project-route"
import {
  listProjectWorkspaces,
  type ProjectWorkspace,
} from "@/lib/project-workspace"
import { useProjectUiStore } from "@/stores/project-ui-store"
import { useSourceStore } from "@/stores/source-store"

const MAX_PROJECTS = 5

function formatUpdated(timestamp: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(timestamp))
  } catch {
    return ""
  }
}

function projectTitle(project: ProjectWorkspace): string {
  return project.source?.title || project.source?.inputUrl || project.id
}

export function ProjectHistory() {
  const { t, locale } = useI18n()
  const project = useProjectWorkspaceController()
  const hasSource = useSourceStore((state) => Boolean(state.streamUrl))
  const historyOpen = useProjectUiStore((state) => state.historyOpen)
  const setHistoryOpen = useProjectUiStore((state) => state.setHistoryOpen)
  const [pending, setPending] = useState<ProjectWorkspace | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const refreshTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
      }
    }
  }, [])

  // Liste her render'da localStorage'dan okunur; yenile düğmesi `refreshing`
  // durumunu değiştirerek güncel kayıtların görünmesini sağlar.
  const projects = listProjectWorkspaces()
    .filter((item) => item.id !== project.projectId)
    .slice(0, MAX_PROJECTS)

  const refreshProjects = () => {
    setRefreshing(true)
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current)
    }
    refreshTimerRef.current = window.setTimeout(() => {
      setRefreshing(false)
      refreshTimerRef.current = null
    }, 650)
  }

  const openInCurrentTab = (id: string) => {
    // Hash değişikliği tek başına sayfayı yeniden yüklemez; proje hidrasyonu
    // yalnızca açılışta çalıştığı için tam sayfa yükleme tetiklenir.
    window.location.assign(projectUrl(id))
    window.setTimeout(() => window.location.reload(), 0)
  }

  const openInNewTab = (id: string) => {
    window.open(projectUrl(id), "_blank", "noopener,noreferrer")
  }

  const requestOpen = (item: ProjectWorkspace) => {
    if (hasSource) {
      setPending(item)
      return
    }
    openInCurrentTab(item.id)
  }

  if (projects.length === 0) return null

  return (
    <div className="space-y-1.5 border-t border-border/60 pt-2">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => setHistoryOpen(!historyOpen)}
          aria-expanded={historyOpen}
          aria-controls="project-history-list"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md px-1 py-1 text-left text-[10px] font-medium tracking-wide text-muted-foreground uppercase transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <History className="size-3" />
          <span className="min-w-0 flex-1 truncate">
            {t("project.historyTitle")}
          </span>
          <ChevronDown
            className={cn(
              "size-3 shrink-0 transition-transform",
              historyOpen && "rotate-180",
            )}
            aria-hidden
          />
        </button>

        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-5 shrink-0 text-muted-foreground hover:bg-muted/40 hover:text-foreground active:scale-90 disabled:opacity-100"
          onClick={refreshProjects}
          title={t("project.historyRefresh")}
          aria-label={t("project.historyRefresh")}
          aria-busy={refreshing}
          disabled={refreshing}
        >
          <RefreshCwIcon
            className={cn("size-3", refreshing && "animate-spin")}
            aria-hidden
          />
        </Button>
      </div>

      <ul
        id="project-history-list"
        className={cn("space-y-0.5", !historyOpen && "hidden")}
      >
        {projects.map((item) => (
          <li key={item.id} className="group flex items-center gap-0.5">
            <button
              type="button"
              className="min-w-0 flex-1 rounded-md px-1.5 py-1 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => requestOpen(item)}
              title={projectTitle(item)}
            >
              <span className="block truncate text-[11px] font-medium">
                {projectTitle(item)}
              </span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {formatUpdated(item.updated_date, locale)}
              </span>
            </button>

            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 text-muted-foreground opacity-70 group-hover:opacity-100"
              onClick={() => openInNewTab(item.id)}
              title={t("project.historyOpenNewTab")}
              aria-label={`${t("project.historyOpenNewTab")}: ${projectTitle(item)}`}
            >
              <ExternalLink />
            </Button>
          </li>
        ))}
      </ul>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("project.historyConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("project.historyConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {pending && (
            <p className="truncate rounded-lg border bg-muted/30 px-3 py-2 text-left text-xs font-medium">
              {projectTitle(pending)}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                const target = pending
                setPending(null)
                if (target) openInNewTab(target.id)
              }}
            >
              <ExternalLink />
              {t("project.historyOpenNewTab")}
            </Button>
            <AlertDialogAction
              onClick={() => {
                const target = pending
                setPending(null)
                if (target) openInCurrentTab(target.id)
              }}
            >
              {t("project.historyOpen")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
