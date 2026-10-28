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
        className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/70 bg-card/40 px-6 py-12 text-center"
      >
        <span className="flex size-10 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground/70">
          <FilmIcon className="size-5" />
        </span>
        <p className="text-xs font-medium text-foreground">
          {t("home.recentEmpty")}
        </p>
        <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
          {t("home.recentEmptyHint")}
        </p>
      </div>
    )
  }

  return (
    <>
      <ul data-slot="recent-projects" className="grid gap-2 sm:grid-cols-2">
        {projects.map((item) => (
          <li
            key={item.id}
            className="group relative flex items-center gap-2 rounded-xl border border-border/60 bg-card/60 p-2.5 transition-colors hover:border-primary/30 hover:bg-card focus-within:border-primary/30"
          >
            <button
              type="button"
              onClick={() => openProject(item.id)}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={projectTitle(item, item.id)}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/10">
                <FilmIcon className="size-4" />
              </span>
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="block truncate text-xs font-medium">
                  {projectTitle(item, t("menu.untitledProject"))}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {formatUpdated(item.updated_date, locale)}
                  {item.source?.isLive ? ` · ${t("stage.liveOnly")}` : ""}
                </span>
              </span>
            </button>

            <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground"
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
                className={cn("text-muted-foreground hover:text-destructive")}
                onClick={() => setDeleting(item)}
                title={t("project.historyDelete")}
                aria-label={`${t("project.historyDelete")}: ${projectTitle(item, item.id)}`}
              >
                <Trash2Icon />
              </Button>
            </div>
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
