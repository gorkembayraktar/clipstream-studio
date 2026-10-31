/** Ana sayfadaki son projeler: yatay kaydırmalı (swipe/glide) kart şeridi. */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FilmIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "@/lib/notify"

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
    project.title ??
    sourceDisplayName(project.source?.title, project.source?.inputUrl) ??
    fallback
  )
}

/** Proje tam sayfa yüklenir: hidrasyon yalnızca açılışta çalışır. */
function openProject(id: string) {
  window.location.assign(projectUrl(id))
}

function ProjectCard({
  item,
  layout,
  onDelete,
}: {
  item: ProjectWorkspace
  layout: "row" | "list" | "grid"
  onDelete: (item: ProjectWorkspace) => void
}) {
  const { t, locale } = useI18n()

  return (
    <li
      className={cn(
        "group relative flex items-center gap-2 rounded-xl border border-border/60 bg-card/60 transition-all duration-300 hover:border-primary/30 hover:bg-card focus-within:border-primary/30",
        layout === "row"
          ? "w-64 shrink-0 snap-start p-2.5 sm:w-72"
          : layout === "grid"
            ? "w-full p-2.5 hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/5"
            : "w-full p-3",
      )}
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
          onClick={() => onDelete(item)}
          title={t("project.historyDelete")}
          aria-label={`${t("project.historyDelete")}: ${projectTitle(item, item.id)}`}
        >
          <Trash2Icon />
        </Button>
      </div>
    </li>
  )
}

/**
 * Yatay kaydırma şeridi: dokunmatikte native swipe, masaüstünde fare ile
 * sürükleme, kenar oklarında yumuşak kaydırma ve kartlara snap.
 */
function GlideRow({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const scrollerRef = useRef<HTMLUListElement>(null)
  const dragRef = useRef<{
    startX: number
    startLeft: number
    moved: boolean
  } | null>(null)
  const suppressClickRef = useRef(false)
  /** Sürükleme sırasında pencere dinleyicilerini kaldırır. */
  const cleanupRef = useRef<(() => void) | null>(null)
  const [dragging, setDragging] = useState(false)
  const [canPrev, setCanPrev] = useState(false)
  const [canNext, setCanNext] = useState(false)

  const sync = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    setCanPrev(el.scrollLeft > 2)
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  // Kart sayısı ya da genişlik değişince okları tazele.
  useEffect(() => {
    sync()
    const el = scrollerRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    return () => observer.disconnect()
  }, [sync, children])

  const page = (direction: 1 | -1) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({
      left: direction * Math.max(el.clientWidth * 0.8, 240),
      behavior: "smooth",
    })
  }

  /** Sürüklemeyi bitirir; kart tıklaması yalnızca gerçekten kaydırıldıysa yutulur. */
  const endDrag = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    suppressClickRef.current = drag.moved
    setDragging(false)
    sync()
  }, [sync])

  // Bileşen kalkarken pencere dinleyicileri sızmasın.
  useEffect(() => () => cleanupRef.current?.(), [])

  const onPointerDown = (event: ReactPointerEvent<HTMLUListElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return
    const el = scrollerRef.current
    if (!el) return

    dragRef.current = {
      startX: event.clientX,
      startLeft: el.scrollLeft,
      moved: false,
    }
    suppressClickRef.current = false
    setDragging(true)

    // Kartın üzerinde başlayan sürükleme de çalışsın ve imleç şeritten
    // çıksa bile kaydırma sürsün: dinleyiciler pencerede tutulur.
    const onMove = (moveEvent: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const delta = moveEvent.clientX - drag.startX
      if (Math.abs(delta) > 4) drag.moved = true
      el.scrollLeft = drag.startLeft - delta
    }
    const onUp = () => endDrag()

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    cleanupRef.current = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
  }

  /** Sürükleme sonrası kart tıklamasını yut (yanlışlıkla proje açılmasın). */
  const onClickCapture = (event: React.MouseEvent<HTMLUListElement>) => {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div className="group/glide relative">
      <ul
        ref={scrollerRef}
        data-slot="recent-projects"
        aria-label={t("project.historyTitle")}
        onScroll={sync}
        onPointerDown={onPointerDown}
        onClickCapture={onClickCapture}
        className={cn(
          "flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-1",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          dragging ? "cursor-grabbing snap-none select-none" : "cursor-grab",
        )}
      >
        {children}
      </ul>

      {canPrev && (
        <GlideButton
          side="left"
          label={t("home.recentPrev")}
          onClick={() => page(-1)}
        />
      )}
      {canNext && (
        <GlideButton
          side="right"
          label={t("home.recentNext")}
          onClick={() => page(1)}
        />
      )}
    </div>
  )
}

function GlideButton({
  side,
  label,
  onClick,
}: {
  side: "left" | "right"
  label: string
  onClick: () => void
}) {
  const Icon = side === "left" ? ChevronLeftIcon : ChevronRightIcon
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "absolute top-1/2 hidden size-7 -translate-y-1/2 items-center justify-center rounded-full",
        "border border-border/70 bg-background/90 text-muted-foreground shadow-sm backdrop-blur",
        "transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:flex",
        side === "left" ? "-left-2" : "-right-2",
      )}
    >
      <Icon className="size-3.5" />
    </button>
  )
}

export function RecentProjects({
  limit = 12,
  layout = "row",
  emptyHint = true,
  showHeader = false,
  hideWhenEmpty = false,
}: {
  limit?: number
  layout?: "row" | "list" | "grid"
  /** Boş durumda açıklama satırını göster. */
  emptyHint?: boolean
  /** "Son projeler" başlığını ve rozetini bileşen içinde çiz. */
  showHeader?: boolean
  /** Proje yoksa bölümü tamamen gizle (boş durum kartı yerine). */
  hideWhenEmpty?: boolean
}) {
  const { t } = useI18n()
  const [deleting, setDeleting] = useState<ProjectWorkspace | null>(null)
  const [version, setVersion] = useState(0)

  // Liste localStorage'dan okunur; silme sonrası `version` yeniden okutur.
  const projects = listProjectWorkspaces().slice(0, limit)
  void version

  if (projects.length === 0) {
    if (hideWhenEmpty) return null

    return (
      <div
        data-slot="recent-projects-empty"
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-2xl bg-card/40 text-center",
          layout === "row" ? "px-6 py-12" : "px-4 py-8",
        )}
      >
        <span className="flex size-10 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground/70">
          <FilmIcon className="size-5" />
        </span>
        <p className="text-xs font-medium text-foreground">
          {t("home.recentEmpty")}
        </p>
        {emptyHint && (
          <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
            {t("home.recentEmptyHint")}
          </p>
        )}
      </div>
    )
  }

  return (
    <>
      {showHeader && (
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight">
            {t("project.historyTitle")}
          </h2>
          <span className="text-[10px] text-muted-foreground">
            {t("home.recentBadge")}
          </span>
        </div>
      )}

      {layout === "row" ? (
        <GlideRow>
          {projects.map((item) => (
            <ProjectCard
              key={item.id}
              item={item}
              layout="row"
              onDelete={setDeleting}
            />
          ))}
        </GlideRow>
      ) : layout === "grid" ? (
        <ul
          data-slot="recent-projects"
          aria-label={t("project.historyTitle")}
          className="home-stagger grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
        >
          {projects.map((item) => (
            <ProjectCard
              key={item.id}
              item={item}
              layout="grid"
              onDelete={setDeleting}
            />
          ))}
        </ul>
      ) : (
        <ul
          data-slot="recent-projects"
          aria-label={t("project.historyTitle")}
          className="home-stagger space-y-2"
        >
          {projects.map((item) => (
            <ProjectCard
              key={item.id}
              item={item}
              layout="list"
              onDelete={setDeleting}
            />
          ))}
        </ul>
      )}

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
