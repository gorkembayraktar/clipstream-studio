import { useState } from "react"
import {
  ExternalLink,
  Film,
  FolderOpen,
  LayoutGrid,
  List,
  MoreVertical,
  Plus,
  Search,
  Trash2,
  Video,
} from "lucide-react"

import { SourceCurlDialog } from "@/components/app/source-panels"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { projectUrl } from "@/lib/project-route"
import {
  listProjectWorkspaces,
  removeProjectWorkspace,
} from "@/lib/project-workspace"
import { useSourceResolve } from "@/hooks/use-source-resolve"
import { useLocalImportStore } from "@/stores/local-import-store"
import { cn } from "cn"

import { ResolveStatusView } from "./shared"

export function VariantNle() {
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
  } = useSourceResolve()

  const [curlOpen, setCurlOpen] = useState(false)
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [searchQuery, setSearchQuery] = useState("")
  const [showUrlDialog, setShowUrlDialog] = useState(false)
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
      data-slot="variant-nle"
      className="flex h-full min-h-0 flex-1 overflow-hidden bg-background text-foreground"
    >
      {/* Sol Uygulama Eylem Rayı (Sidebar) */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-border/80 bg-card/60 p-4">
        {/* Logo / Başlık */}
        <div className="flex items-center gap-2.5 px-2 py-1">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
            <Film className="size-4" />
          </div>
          <div>
            <span className="block text-xs font-bold tracking-tight">ClipStream</span>
            <span className="block text-[10px] text-muted-foreground font-mono">
              v0.2.13 · Desktop
            </span>
          </div>
        </div>

        {/* Ana Başlatma Düğmeleri */}
        <div className="mt-6 space-y-2">
          <Button
            type="button"
            className="w-full justify-start gap-2 h-9 text-xs font-semibold shadow-xs"
            onClick={() => setShowUrlDialog(true)}
          >
            <Plus className="size-4" />
            <span>New Session from URL...</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            className="w-full justify-start gap-2 h-9 text-xs font-medium"
            onClick={() => void pickFile()}
          >
            <FolderOpen className="size-4 text-primary" />
            <span>Open Video File...</span>
          </Button>
        </div>

        {/* Kenar Çubuğu Menüsü */}
        <div className="mt-6 flex-1 space-y-1">
          <span className="px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
            Workspaces
          </span>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-lg bg-accent/80 px-2.5 py-1.5 text-xs font-medium text-accent-foreground"
          >
            <span>Recent Projects</span>
            <span className="rounded-full bg-background px-1.5 py-0.2 text-[10px] font-mono">
              {allProjects.length}
            </span>
          </button>
        </div>

        {/* Alt Hızlı cURL / Ayarlar */}
        <div className="border-t border-border/60 pt-3">
          <button
            type="button"
            onClick={() => setCurlOpen(true)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <span className="font-mono text-[11px]">curl</span>
            <span>cURL / Custom Stream...</span>
          </button>
        </div>
      </aside>

      {/* Ana Proje Tarayıcı Alanı */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Üst Araç Çubuğu */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/80 px-6">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Recent Workspaces</h2>
            <span className="text-xs text-muted-foreground">({filteredProjects.length})</span>
          </div>

          <div className="flex items-center gap-3">
            {/* Arama */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
              <Input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter projects..."
                className="h-8 w-44 pl-8 text-xs sm:w-56"
              />
            </div>

            {/* Görünüm Modu (Grid / List) */}
            <div className="flex items-center rounded-lg border border-border/60 bg-muted/30 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={cn(
                  "p-1 rounded-md text-muted-foreground hover:text-foreground",
                  viewMode === "grid" && "bg-background text-foreground shadow-2xs",
                )}
                title="Grid View"
              >
                <LayoutGrid className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={cn(
                  "p-1 rounded-md text-muted-foreground hover:text-foreground",
                  viewMode === "list" && "bg-background text-foreground shadow-2xs",
                )}
                title="List View"
              >
                <List className="size-3.5" />
              </button>
            </div>
          </div>
        </header>

        {/* URL Giriş Modal/Şerit Çubuğu (Açıldığında) */}
        {showUrlDialog && (
          <div className="border-b border-border/80 bg-accent/40 p-4">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void load()
              }}
              className="mx-auto flex max-w-2xl items-center gap-2"
            >
              <Input
                ref={inputRef}
                type="search"
                autoFocus
                placeholder="Paste video URL (YouTube, Twitch, TikTok, HLS stream)..."
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                className="h-9 text-xs"
                disabled={resolving}
              />
              <Button type="submit" size="sm" className="h-9 text-xs" disabled={!inputUrl.trim() || resolving}>
                Load Clip
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 text-xs"
                onClick={() => setShowUrlDialog(false)}
              >
                Cancel
              </Button>
            </form>

            <div className="mx-auto mt-2 max-w-2xl">
              <ResolveStatusView
                resolving={resolving}
                progress={progress}
                stage={stage}
                detail={detail}
                onCancel={cancel}
                hasInputUrl={Boolean(inputUrl)}
              />
            </div>
          </div>
        )}

        {/* Projeler Listesi */}
        <div className="flex-1 overflow-y-auto p-6">
          {filteredProjects.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground/60 mb-3">
                <Video className="size-7" />
              </div>
              <h3 className="text-sm font-semibold">No Projects Found</h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Click "New Session from URL" in the sidebar, open a local file, or drag & drop a video anywhere.
              </p>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredProjects.map((project) => (
                <div
                  key={project.id}
                  onClick={() => window.location.assign(projectUrl(project.id))}
                  role="button"
                  tabIndex={0}
                  className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border/80 bg-card p-3 shadow-2xs transition-all hover:border-primary/50 hover:shadow-md cursor-pointer"
                >
                  <div>
                    {/* 16:9 Thumbnail Kutusu */}
                    <div className="relative aspect-video w-full rounded-lg bg-neutral-900 flex items-center justify-center text-neutral-600 group-hover:text-primary transition-colors">
                      <Film className="size-8" />
                      <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[9px] text-white">
                        {project.source?.platform || "VIDEO"}
                      </span>
                    </div>

                    <h4 className="mt-2.5 line-clamp-1 text-xs font-semibold text-foreground group-hover:text-primary">
                      {project.title || project.source?.title || "Untitled Project"}
                    </h4>

                    <span className="mt-0.5 line-clamp-1 text-[11px] font-mono text-muted-foreground">
                      {project.source?.inputUrl || "Local source"}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-2 text-[10px] text-muted-foreground">
                    <span>{new Date(project.updated_date).toLocaleDateString()}</span>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          onClick={(e) => e.stopPropagation()}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        >
                          <MoreVertical className="size-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="text-xs">
                        <DropdownMenuItem
                          onClick={() =>
                            window.open(projectUrl(project.id), "_blank", "noopener,noreferrer")
                          }
                        >
                          <ExternalLink className="size-3.5 mr-2" />
                          <span>Open in New Tab</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => handleDelete(project.id, e)}
                          className="text-destructive"
                        >
                          <Trash2 className="size-3.5 mr-2" />
                          <span>Delete</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Tablo Görünümü */
            <div className="rounded-xl border border-border/80 bg-card overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border/80 bg-muted/40 text-[10px] uppercase font-bold text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Name</th>
                    <th className="px-4 py-2.5">Platform</th>
                    <th className="px-4 py-2.5">Last Modified</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredProjects.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => window.location.assign(projectUrl(p.id))}
                      className="hover:bg-muted/30 cursor-pointer"
                    >
                      <td className="px-4 py-3 font-semibold text-foreground">
                        {p.title || p.source?.title || "Untitled Project"}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] uppercase text-muted-foreground">
                        {p.source?.platform || "media"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(p.updated_date).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={(e) => handleDelete(p.id, e)}
                          className="text-destructive/70 hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

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
