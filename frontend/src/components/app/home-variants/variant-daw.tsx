import { useState } from "react"
import {
  FileVideo,
  Film,
  FolderOpen,
  Info,
  Link2,
  Loader2,
  Play,
  Terminal,
  Trash2,
} from "lucide-react"

import { SourceCurlDialog } from "@/components/app/source-panels"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { projectUrl } from "@/lib/project-route"
import {
  listProjectWorkspaces,
  removeProjectWorkspace,
  type ProjectWorkspace,
} from "@/lib/project-workspace"
import { useSourceResolve, DEMO_URL } from "@/hooks/use-source-resolve"
import { useLocalImportStore } from "@/stores/local-import-store"
import { cn } from "cn"

import { ResolveStatusView } from "./shared"

export function VariantDaw() {
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const allProjects = listProjectWorkspaces()
  void refreshKey

  const selectedProject: ProjectWorkspace | null =
    allProjects.find((p) => p.id === selectedId) || allProjects[0] || null

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    removeProjectWorkspace(id)
    if (selectedId === id) setSelectedId(null)
    setRefreshKey((k) => k + 1)
  }

  return (
    <div
      data-slot="variant-daw"
      className="flex h-full min-h-0 flex-1 overflow-hidden bg-neutral-950 font-sans text-neutral-200 select-none"
    >
      {/* 1. PANEL: Sol Kütüphane Gezgini (Navigator, w-52) */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900/60 p-3">
        <div className="flex items-center gap-2 px-2 py-1">
          <Film className="size-4 text-primary" />
          <span className="text-xs font-bold tracking-tight text-neutral-100">
            ClipStream Studio
          </span>
        </div>

        <div className="mt-5 space-y-1">
          <span className="px-2 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
            Library
          </span>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-xs font-medium bg-neutral-800 text-neutral-100"
          >
            <span>All Projects</span>
            <span className="font-mono text-[10px] text-neutral-400">{allProjects.length}</span>
          </button>
        </div>

        <div className="mt-6 flex-1 space-y-1">
          <span className="px-2 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
            Direct Ingest
          </span>
          <button
            type="button"
            onClick={() => void pickFile()}
            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            <FolderOpen className="size-3.5 text-primary" />
            <span>Open Local Video...</span>
          </button>
          <button
            type="button"
            onClick={() => setCurlOpen(true)}
            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            <Terminal className="size-3.5 text-amber-500" />
            <span>cURL Stream...</span>
          </button>
          <button
            type="button"
            onClick={() => void load(DEMO_URL)}
            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            <Play className="size-3.5 text-emerald-500" />
            <span>Load Demo Video</span>
          </button>
        </div>

        <div className="border-t border-neutral-800 pt-3 text-[10px] font-mono text-neutral-500">
          <span className="flex items-center gap-1.5 text-emerald-500">
            ● Engine: FFmpeg 7 Active
          </span>
        </div>
      </aside>

      {/* 2. PANEL: Orta Proje Tablosu (flex-1) */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-neutral-800 bg-neutral-950">
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-neutral-800 px-4">
          <span className="text-xs font-bold text-neutral-300">
            Workspaces ({allProjects.length})
          </span>
          <span className="text-[10px] text-neutral-500 font-mono">
            Double-click or select to inspect
          </span>
        </div>

        {/* İlerleme Paneli */}
        {(resolving || inputUrl) && (
          <div className="p-3 border-b border-neutral-800 bg-neutral-900/60">
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

        {/* Proje Tablosu */}
        <div className="flex-1 overflow-y-auto">
          {allProjects.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-xs text-neutral-500">
              <FileVideo className="size-8 text-neutral-700 mb-2" />
              <span>No projects in workspace library.</span>
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="border-b border-neutral-800 bg-neutral-900/80 font-mono text-[10px] uppercase text-neutral-400 sticky top-0">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Platform</th>
                  <th className="px-4 py-2">Last Modified</th>
                  <th className="px-4 py-2 text-right">Delete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900">
                {allProjects.map((p) => {
                  const isSelected = selectedProject?.id === p.id
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setSelectedId(p.id)}
                      onDoubleClick={() => window.location.assign(projectUrl(p.id))}
                      className={cn(
                        "cursor-pointer transition-colors",
                        isSelected
                          ? "bg-primary/20 text-white font-medium"
                          : "hover:bg-neutral-900 text-neutral-300",
                      )}
                    >
                      <td className="px-4 py-2.5 truncate max-w-[200px]">
                        {p.title || p.source?.title || "Untitled Project"}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] uppercase text-neutral-400">
                        {p.source?.platform || "media"}
                      </td>
                      <td className="px-4 py-2.5 text-neutral-400 font-mono text-[11px]">
                        {new Date(p.updated_date).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={(e) => handleDelete(p.id, e)}
                          className="text-neutral-500 hover:text-red-400 p-1"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </main>

      {/* 3. PANEL: Sağ Denetçi / Oturum Başlatıcı (Inspector, w-80) */}
      <aside className="flex w-80 shrink-0 flex-col justify-between bg-neutral-900/40 p-4 overflow-y-auto">
        <div className="space-y-6">
          {/* Yeni Oturum Giriş Kutusu */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-4 shadow-sm">
            <span className="block text-xs font-bold text-neutral-200 uppercase tracking-wider mb-2">
              New Clip Session
            </span>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void load()
              }}
              className="space-y-2.5"
            >
              <div className="flex items-center rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1 text-xs">
                <Link2 className="size-3.5 text-neutral-500 mr-1.5 shrink-0" />
                <Input
                  ref={inputRef}
                  type="search"
                  placeholder="Paste URL to clip..."
                  className="h-7 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0 text-neutral-100 placeholder:text-neutral-600"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  disabled={resolving}
                />
              </div>

              <Button
                type="submit"
                size="sm"
                className="w-full h-8 text-xs font-semibold"
                disabled={!inputUrl.trim() || resolving}
              >
                {resolving ? (
                  <Loader2 className="size-3.5 animate-spin mr-1.5" />
                ) : (
                  <Play className="size-3 fill-current mr-1.5" />
                )}
                <span>Launch Session</span>
              </Button>
            </form>
          </div>

          {/* Seçili Proje Detayları (Inspector) */}
          {selectedProject ? (
            <div className="space-y-3 border-t border-neutral-800 pt-4">
              <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-300">
                <Info className="size-3.5 text-primary" />
                <span>Project Inspector</span>
              </div>

              <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs space-y-2">
                <div>
                  <span className="text-[10px] uppercase font-mono text-neutral-500">Title</span>
                  <p className="font-semibold text-neutral-200 truncate">
                    {selectedProject.title || selectedProject.source?.title || "Untitled Project"}
                  </p>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-mono text-neutral-500">Source</span>
                  <p className="font-mono text-[11px] text-neutral-400 truncate">
                    {selectedProject.source?.inputUrl || "Local Media File"}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-neutral-400 pt-1">
                  <span>Cuts: {selectedProject.edit?.segments?.length || 1}</span>
                  <span>Live: {selectedProject.source?.isLive ? "Yes" : "No"}</span>
                </div>
              </div>

              <Button
                type="button"
                className="w-full h-9 text-xs font-bold bg-primary text-primary-foreground"
                onClick={() => window.location.assign(projectUrl(selectedProject.id))}
              >
                Open Selected Project →
              </Button>
            </div>
          ) : (
            <div className="text-center text-xs text-neutral-600 py-6">
              Select a project from the center table to view details.
            </div>
          )}
        </div>

        {/* Alt Hızlı Durum */}
        <div className="text-[10px] font-mono text-neutral-500 text-center border-t border-neutral-800 pt-3">
          ClipStream Audio/Video Engine
        </div>
      </aside>

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
