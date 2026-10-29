import { useState } from "react"
import {
  Activity,
  ClipboardPaste,
  Cpu,
  ExternalLink,
  FileVideo2,
  Film,
  FolderOpen,
  HardDrive,
  Link2,
  Loader2,
  Play,
  Search,
  Terminal,
  Trash2,
} from "lucide-react"

import { SourceCurlDialog } from "@/components/app/source-panels"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useI18n } from "@/i18n"
import { projectUrl } from "@/lib/project-route"
import {
  listProjectWorkspaces,
  removeProjectWorkspace,
  type ProjectWorkspace,
} from "@/lib/project-workspace"
import { useSourceResolve, DEMO_URL } from "@/hooks/use-source-resolve"
import { useLocalImportStore } from "@/stores/local-import-store"

import { ResolveStatusView, StudioSecurityPill, SUPPORTED_PLATFORMS } from "./shared"

export function VariantToolbelt() {
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
  const [filterQuery, setFilterQuery] = useState("")
  const [refreshVersion, setRefreshVersion] = useState(0)

  const allProjects = listProjectWorkspaces()
  void refreshVersion

  const filteredProjects = allProjects.filter((p) => {
    if (!filterQuery.trim()) return true
    const q = filterQuery.toLowerCase()
    const title = (p.title || p.source?.title || "").toLowerCase()
    const url = (p.source?.inputUrl || "").toLowerCase()
    return title.includes(q) || url.includes(q)
  })

  const handleDelete = (project: ProjectWorkspace) => {
    removeProjectWorkspace(project.id)
    setRefreshVersion((v) => v + 1)
  }

  return (
    <div
      data-slot="variant-toolbelt"
      className="relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-background"
    >
      {/* Üst Komut Çubuğu (Pro Toolbelt Strip) */}
      <div className="sticky top-0 z-10 border-b border-border/80 bg-card/95 px-4 py-3 shadow-xs backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          {/* Sol: Hızlı URL Girişi */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void load()
            }}
            className="flex min-w-[280px] flex-1 items-center gap-2 max-w-xl"
          >
            <div className="relative flex flex-1 items-center rounded-lg border border-border/70 bg-background px-2.5 py-1">
              <Link2 className="size-3.5 shrink-0 text-muted-foreground mr-1.5" />
              <Input
                ref={inputRef}
                type="search"
                className="h-8 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
                placeholder="Enter URL or stream address..."
                spellCheck={false}
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                disabled={resolving}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => void paste()}
                disabled={resolving}
                title={t("source.paste")}
              >
                <ClipboardPaste className="size-3" />
              </Button>
            </div>

            <Button
              type="submit"
              size="sm"
              className="h-8 gap-1.5 px-3 text-xs font-medium"
              disabled={!inputUrl.trim() || resolving}
            >
              {resolving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5 fill-current" />
              )}
              <span>Load</span>
            </Button>
          </form>

          {/* Orta/Sağ: Araçlar */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => void pickFile()}
              disabled={resolving}
            >
              <FileVideo2 className="size-3.5 text-primary" />
              <span>Open File</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs text-muted-foreground"
              onClick={() => setCurlOpen(true)}
              disabled={resolving}
            >
              <Terminal className="size-3.5 text-amber-500" />
              <span>cURL</span>
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground"
              onClick={() => void load(DEMO_URL)}
              disabled={resolving}
            >
              <span>Demo</span>
            </Button>

            <div className="hidden h-5 w-px bg-border/60 sm:block mx-1" />

            <div className="hidden items-center gap-1.5 rounded-md bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 sm:flex">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Studio Engine Ready</span>
            </div>
          </div>
        </div>
      </div>

      {/* İlerleme Panelleri */}
      {(resolving || inputUrl) && (
        <div className="mx-auto mt-4 w-full max-w-4xl px-4 sm:px-6">
          <ResolveStatusView
            resolving={resolving}
            progress={progress}
            stage={stage}
            detail={detail}
            onCancel={cancel}
            hasInputUrl={Boolean(inputUrl)}
          />
        </div>
      )}

      {/* Ana Çalışma Alanı (Sekmeler & Proje Yöneticisi) */}
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <Tabs defaultValue="projects" className="w-full">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
            <TabsList className="h-9">
              <TabsTrigger value="projects" className="gap-1.5 text-xs">
                <FolderOpen className="size-3.5" />
                <span>Workspaces ({allProjects.length})</span>
              </TabsTrigger>
              <TabsTrigger value="platforms" className="gap-1.5 text-xs">
                <Film className="size-3.5" />
                <span>Supported Sources</span>
              </TabsTrigger>
              <TabsTrigger value="system" className="gap-1.5 text-xs">
                <Cpu className="size-3.5" />
                <span>Engine Diagnostics</span>
              </TabsTrigger>
            </TabsList>

            {/* Arama Kutusu */}
            <div className="relative flex items-center">
              <Search className="absolute left-2.5 size-3.5 text-muted-foreground pointer-events-none" />
              <Input
                type="search"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Filter saved projects..."
                className="h-8 w-48 pl-8 text-xs sm:w-64"
              />
            </div>
          </div>

          {/* Sekme 1: Projeler */}
          <TabsContent value="projects" className="mt-6 space-y-4">
            {filteredProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 p-12 text-center">
                <FolderOpen className="size-10 text-muted-foreground/60 mb-2" />
                <h3 className="text-sm font-semibold text-foreground">
                  {filterQuery ? "No matching projects" : "No workspaces yet"}
                </h3>
                <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                  {filterQuery
                    ? "Try adjusting your search query."
                    : "Paste a video link or choose a local file from the top toolbar to start editing."}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredProjects.map((project) => (
                  <div
                    key={project.id}
                    className="group relative flex flex-col justify-between rounded-xl border border-border/70 bg-card p-4 transition-all hover:border-primary/40 hover:shadow-sm"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline" className="text-[10px] uppercase font-mono">
                          {project.source?.platform || "media"}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(project.updated_date).toLocaleDateString()}
                        </span>
                      </div>

                      <h4 className="mt-2 line-clamp-2 text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                        {project.title || project.source?.title || "Untitled Project"}
                      </h4>

                      <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground font-mono">
                        {project.source?.inputUrl || "Local source"}
                      </p>

                      <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span>
                          {project.edit?.segments?.length
                            ? `${project.edit.segments.length} segment(s)`
                            : "1 clip"}
                        </span>
                        {project.source?.isLive && <span>· 🔴 Live</span>}
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-border/40 pt-2.5">
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-[11px] gap-1 px-2.5"
                        onClick={() => window.location.assign(projectUrl(project.id))}
                      >
                        <Play className="size-3 fill-current" />
                        <span>Open</span>
                      </Button>

                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="text-muted-foreground"
                          onClick={() =>
                            window.open(projectUrl(project.id), "_blank", "noopener,noreferrer")
                          }
                          title="Open in new tab"
                        >
                          <ExternalLink className="size-3.5" />
                        </Button>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="text-destructive/70 hover:text-destructive"
                          onClick={() => handleDelete(project)}
                          title="Delete session"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Sekme 2: Desteklenen Servisler */}
          <TabsContent value="platforms" className="mt-6">
            <div className="rounded-2xl border border-border/70 bg-card p-6">
              <h3 className="text-sm font-semibold">Supported Video Formats & Streams</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                ClipStream uses local yt-dlp & FFmpeg engines to ingest high quality streams.
              </p>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {SUPPORTED_PLATFORMS.map((plat) => (
                  <div
                    key={plat}
                    className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/20 p-3 text-xs font-medium"
                  >
                    <Film className="size-4 text-primary" />
                    <span>{plat}</span>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* Sekme 3: Sistem Teşhis Bilgisi */}
          <TabsContent value="system" className="mt-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-border/70 bg-card p-5">
                <Activity className="size-5 text-emerald-500 mb-2" />
                <h4 className="text-xs font-semibold">Processing Pipeline</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  Local FFmpeg & HLS.js direct playback. Hardware decoding enabled.
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-card p-5">
                <HardDrive className="size-5 text-sky-500 mb-2" />
                <h4 className="text-xs font-semibold">Workspace Storage</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  IndexedDB & localStorage. Clips stay entirely on your device.
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-card p-5">
                <Cpu className="size-5 text-amber-500 mb-2" />
                <h4 className="text-xs font-semibold">GPU Acceleration</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  Supports NVIDIA NVENC, Intel QSV, Apple VideoToolbox, and AMD AMF.
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Güvenlik Notu */}
        <div className="mt-12 text-center">
          <StudioSecurityPill />
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
