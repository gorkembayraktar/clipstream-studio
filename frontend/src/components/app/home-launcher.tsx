/** Ana sayfa: "Desktop Launcher".
 *
 * Solda oturum başlatma eylemleri (URL, dosya, pano, demo, cURL), sağda son
 * çalışma alanları ve arama. Kaynak çözümleme akışı `useSourceResolve` içinde.
 */
import { useState } from "react"
import {
  ArrowRight,
  ClipboardPaste,
  FileVideo,
  Film,
  FolderOpen,
  Keyboard,
  Link2,
  Loader2,
  Play,
  Search,
  Terminal,
  Trash2,
} from "lucide-react"

import {
  ImportProgressCard,
  ResolveProgressCard,
  SourceCurlDialog,
  SourceSummaryCard,
} from "@/components/app/source-panels"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSourceResolve, DEMO_URL } from "@/hooks/use-source-resolve"
import { useI18n } from "@/i18n"
import { APP_VERSION } from "@/lib/app-version"
import { projectUrl } from "@/lib/project-route"
import {
  listProjectWorkspaces,
  removeProjectWorkspace,
} from "@/lib/project-workspace"
import { useLocalImportStore } from "@/stores/local-import-store"

const SHORTCUTS = [
  { keys: "Space", labelKey: "home.launcher.shortcutPlay" },
  { keys: "I / O", labelKey: "home.launcher.shortcutTrim" },
  { keys: "Shift + Drag", labelKey: "home.launcher.shortcutCut" },
  { keys: "Ctrl + V", labelKey: "home.launcher.shortcutPaste" },
] as const

export function HomeLauncher() {
  const { t } = useI18n()
  const pickFile = useLocalImportStore((s) => s.pickFile)

  const {
    inputUrl,
    setInputUrl,
    inputRef,
    resolving,
    progress,
    stage,
    detail,
    load,
    cancel,
    paste,
  } = useSourceResolve()

  const [curlOpen, setCurlOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [refreshKey, setRefreshKey] = useState(0)

  const allProjects = listProjectWorkspaces()
  void refreshKey

  const filteredProjects = allProjects.filter((p) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    const title = (p.title || p.source?.title || "").toLowerCase()
    const url = (p.source?.inputUrl || "").toLowerCase()
    return title.includes(q) || url.includes(q)
  })

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    removeProjectWorkspace(id)
    setRefreshKey((k) => k + 1)
  }

  return (
    <div
      data-slot="home-launcher"
      className="flex h-full min-h-0 flex-1 overflow-hidden bg-background text-foreground"
    >
      <div className="mx-auto flex h-full w-full max-w-5xl items-center justify-center p-8">
        <div className="grid h-full max-h-[580px] w-full grid-cols-1 overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xl md:grid-cols-12">
          {/* Sol panel: oturum başlatma ve eylemler */}
          <div className="flex flex-col justify-between border-b border-border/70 p-6 md:col-span-5 md:border-b-0 md:border-r">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Film className="size-4" />
                </div>
                <div>
                  <h1 className="text-sm font-bold tracking-tight">ClipStream Studio</h1>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {t("home.launcher.version", { version: APP_VERSION })}
                  </span>
                </div>
              </div>

              <div className="mt-6 space-y-4">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {t("home.launcher.startSession")}
                </span>

                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void load()
                  }}
                  className="space-y-2"
                >
                  <div className="flex items-center rounded-lg border border-border/80 bg-background px-2.5 py-1 text-xs">
                    <Link2 className="size-3.5 text-muted-foreground mr-1.5 shrink-0" />
                    <Input
                      ref={inputRef}
                      type="search"
                      aria-label={t("source.urlAria")}
                      placeholder={t("source.urlPlaceholder")}
                      className="h-7 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
                      value={inputUrl}
                      onChange={(e) => setInputUrl(e.target.value)}
                      disabled={resolving}
                    />
                    <Button
                      type="submit"
                      size="icon-xs"
                      className="shrink-0"
                      aria-label={t("source.load")}
                      disabled={!inputUrl.trim() || resolving}
                    >
                      {resolving ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <ArrowRight className="size-3" />
                      )}
                    </Button>
                  </div>
                </form>

                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => void pickFile()}
                    disabled={resolving}
                    className="flex w-full items-center gap-2.5 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
                  >
                    <FolderOpen className="size-4 text-primary" />
                    <span>{t("source.pickFile")}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void paste()}
                    disabled={resolving}
                    className="flex w-full items-center gap-2.5 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
                  >
                    <ClipboardPaste className="size-4 text-muted-foreground" />
                    <span>{t("source.paste")}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void load(DEMO_URL)}
                    disabled={resolving}
                    className="flex w-full items-center gap-2.5 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
                  >
                    <Play className="size-4 text-emerald-500" />
                    <span>{t("source.demo")}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCurlOpen(true)}
                    disabled={resolving}
                    className="flex w-full items-center gap-2.5 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
                  >
                    <Terminal className="size-4 text-amber-500" />
                    <span>{t("source.curl")}</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="border-t border-border/50 pt-4 text-[11px] text-muted-foreground">
              <span className="mb-1.5 flex items-center gap-1.5 font-semibold text-foreground">
                <Keyboard className="size-3" />
                {t("home.launcher.shortcuts")}
              </span>
              <dl className="grid grid-cols-2 gap-1 text-[10px]">
                {SHORTCUTS.map((shortcut) => (
                  <div key={shortcut.keys} className="flex flex-col">
                    <dt className="font-mono text-muted-foreground/80">{shortcut.keys}</dt>
                    <dd className="truncate">{t(shortcut.labelKey)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          {/* Sağ panel: son çalışma alanları */}
          <div className="flex flex-col overflow-hidden p-6 md:col-span-7">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {t("home.launcher.recentWorkspaces")}
              </h2>

              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
                <Input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("home.launcher.filterRecent")}
                  aria-label={t("home.launcher.filterRecent")}
                  className="h-7 w-40 pl-7 text-xs"
                />
              </div>
            </div>

            {(resolving || inputUrl) && (
              <div className="my-2 space-y-2">
                {resolving && (
                  <ResolveProgressCard
                    progress={progress}
                    stage={stage}
                    detail={detail}
                    onCancel={cancel}
                  />
                )}
                <ImportProgressCard />
                <SourceSummaryCard />
              </div>
            )}

            <div className="flex-1 overflow-y-auto pt-2 space-y-1">
              {filteredProjects.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center text-center text-xs text-muted-foreground">
                  <FileVideo className="size-8 text-muted-foreground/40 mb-2" />
                  <span>{t("home.launcher.noRecent")}</span>
                </div>
              ) : (
                filteredProjects.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => window.location.assign(projectUrl(p.id))}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        window.location.assign(projectUrl(p.id))
                      }
                    }}
                    className="group flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors hover:bg-accent"
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <span className="block truncate font-medium text-foreground group-hover:text-primary">
                        {p.title || p.source?.title || t("menu.untitledProject")}
                      </span>
                      <span className="block truncate text-[10px] font-mono text-muted-foreground">
                        {p.source?.inputUrl || t("home.launcher.localVideo")}
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-3 text-[10px] text-muted-foreground">
                      <span>{new Date(p.updated_date).toLocaleDateString()}</span>
                      <button
                        type="button"
                        onClick={(e) => handleDelete(p.id, e)}
                        className="p-1 opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                        title={t("home.launcher.removeHistory")}
                        aria-label={t("home.launcher.removeHistory")}
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <SourceCurlDialog
        open={curlOpen}
        onOpenChange={setCurlOpen}
        disabled={resolving}
        onSubmit={(url, headers) => {
          setInputUrl(url)
          void load(url, headers)
        }}
      />
    </div>
  )
}
