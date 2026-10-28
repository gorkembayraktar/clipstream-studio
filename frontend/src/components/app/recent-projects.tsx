/** Ana sayfadaki son projeler listesi: localStorage'daki proje kayıtlarından. */
import { useState } from "react"

import { ExternalLinkIcon, FilmIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

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
import { sourceDisplayName } from "@/lib/format"
import { projectUrl } from "@/lib/project-route"
import {
  listProjectWorkspaces,
  removeProjectWorkspace,
  type ProjectWorkspace,
} from "@/lib/project-workspace"
import { cn } from "cn"

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

function projectTitle(project: ProjectWorkspace, fallback: string): string {
  return (
    sourceDisplayName(project.source?.title, project.source?.inputUrl) ?? fallback
  )
}

/** Proje tam sayfa yüklenir: hidrasyon yalnızca açılışta çalışır. */
function openProject(id: string) {
  window.location.assign(projectUrl(id))
}

export function RecentProjects({ limit = 12 }: { limit?: number }) {
  const { t, locale } = useI18n()
  const [deleting, setDeleting] = useState<ProjectWorkspace | null>(null)
  const [version, setVersion] = useState(0)

  // Liste localStorage'dan okunur; silme sonrası `version` yeniden okutur.
  const projects = listProjectWorkspaces().slice(0, limit)
  void version

  if (projects.length === 0) {
    return (
      <div
        data-slot="recent-projects-empty"
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 px-4 py-10 text-center"
      >
        <FilmIcon className="size-6 text-muted-foreground/60" />
        <p className="text-xs font-medium text-foreground">
          {t("home.recentEmpty")}
        </p>
        <p className="max-w-xs text-[11px] text-muted-foreground">
          {t("home.recentEmptyHint")}
        </p>
      </div>
    )
  }

  return (
    <>
      <ul data-slot="recent-projects" className="space-y-1.5">
        {projects.map((item) => (
          <li
            key={item.id}
            className="group flex items-center gap-2 rounded-lg border border-transparent px-1.5 py-1.5 transition-colors hover:border-border/70 hover:bg-muted/40"
          >
            <button
              type="button"
              onClick={() => openProject(item.id)}
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={projectTitle(item, item.id)}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <FilmIcon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">
                  {projectTitle(item, t("menu.untitledProject"))}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {formatUpdated(item.updated_date, locale)}
                  {item.source?.isLive ? ` · ${t("stage.liveOnly")}` : ""}
                </span>
              </span>
            </button>

            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() =>
                window.open(projectUrl(item.id), "_blank", "noopener,noreferrer")
              }
              title={t("project.historyOpenNewTab")}
              aria-label={`${t("project.historyOpenNewTab")}: ${projectTitle(item, item.id)}`}
            >
              <ExternalLinkIcon />
            </Button>

            <Button
              variant="ghost"
              size="icon-xs"
              className={cn(
                "shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100",
              )}
              onClick={() => setDeleting(item)}
              title={t("project.historyDelete")}
              aria-label={`${t("project.historyDelete")}: ${projectTitle(item, item.id)}`}
            >
              <Trash2Icon />
            </Button>
          </li>
        ))}
      </ul>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("project.historyDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("project.historyDeleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {deleting && (
            <p className="truncate rounded-lg border bg-muted/30 px-3 py-2 text-left text-xs font-medium">
              {projectTitle(deleting, deleting.id)}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = deleting
                setDeleting(null)
                if (target) {
                  removeProjectWorkspace(target.id)
                  setVersion((value) => value + 1)
                  toast.success(t("project.deleted"), {
                    description: projectTitle(target, t("menu.untitledProject")),
                  })
                }
              }}
            >
              <Trash2Icon />
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
