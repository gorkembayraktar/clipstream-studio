import { useState } from "react"
import {
  Database,
  ExternalLink,
  Film,
  FolderOpen,
  Plus,
  Search,
  Trash2,
} from "lucide-react"

import { SourceCurlDialog } from "@/components/app/source-panels"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { projectUrl } from "@/lib/project-route"
import {
  listProjectWorkspaces,
  removeProjectWorkspace,
} from "@/lib/project-workspace"
import { useSourceResolve } from "@/hooks/use-source-resolve"
import { useLocalImportStore } from "@/stores/local-import-store"

import { ResolveStatusView } from "./shared"

export function VariantResolve() {
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
  const [searchQuery, setSearchQuery] = useState("")
  const [showInputTile, setShowInputTile] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const allProjects = listProjectWorkspaces()
  void refreshKey

  const filteredProjects = allProjects.filter((p) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    const title = (p.title || p.source?.title || "").toLowerCase()
    return title.includes(q)
  })

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    removeProjectWorkspace(id)
    setRefreshKey((k) => k + 1)
  }

  return (
    <div
      data-slot="variant-resolve"
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-neutral-950 text-neutral-200 select-none"
    >
      {/* DaVinci Üst Başlık Çubuğu */}
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-900 px-5">
        <div className="flex items-center gap-3">
          <Database className="size-4 text-primary" />
          <span className="text-xs font-bold tracking-wider text-neutral-300 uppercase">
            Project Manager
          </span>
          <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] font-mono text-neutral-400">
            Local Workspaces
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-neutral-500" />
            <Input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search projects..."
              className="h-7 w-48 border-neutral-700 bg-neutral-800 pl-7 text-xs text-neutral-200 placeholder:text-neutral-500 rounded"
            />
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 border-neutral-700 bg-neutral-800 text-xs text-neutral-200 hover:bg-neutral-700 rounded"
            onClick={() => void pickFile()}
          >
            <FolderOpen className="size-3 mr-1.5" />
            <span>Open Video</span>
          </Button>

          <Button
            type="button"
            size="sm"
            className="h-7 bg-primary text-primary-foreground text-xs font-semibold rounded"
            onClick={() => setShowInputTile(!showInputTile)}
          >
            <Plus className="size-3.5 mr-1" />
            <span>New Project</span>
          </Button>
        </div>
      </header>

      {/* İlerleme Paneli */}
      {(resolving || inputUrl) && (
        <div className="border-b border-neutral-800 bg-neutral-900/80 p-3">
          <div className="mx-auto max-w-xl">
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

      {/* Proje Kartları Izgarası (Project Tiles Canvas) */}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {/* 1. KART: Yeni Proje / Hızlı Giriş Kartı */}
          <div
            onClick={() => {
              setShowInputTile(true)
              inputRef.current?.focus()
            }}
            className="group relative flex aspect-[4/3] cursor-pointer flex-col justify-between rounded-xl border border-dashed border-neutral-700 bg-neutral-900/40 p-3 transition-all hover:border-primary hover:bg-neutral-900/90"
          >
            {showInputTile ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void load()
                }}
                onClick={(e) => e.stopPropagation()}
                className="flex h-full flex-col justify-between"
              >
                <div>
                  <span className="block text-[10px] font-bold text-primary uppercase">
                    New URL Project
                  </span>
                  <Input
                    ref={inputRef}
                    autoFocus
                    placeholder="Paste URL..."
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    className="mt-2 h-7 border-neutral-700 bg-neutral-950 text-xs font-mono"
                    disabled={resolving}
                  />
                </div>
                <div className="flex gap-1.5 mt-2">
                  <Button
                    type="submit"
                    size="sm"
                    className="h-6 flex-1 text-[10px] font-bold"
                    disabled={!inputUrl.trim() || resolving}
                  >
                    Open
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px]"
                    onClick={() => setShowInputTile(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-neutral-800 text-neutral-400 group-hover:scale-105 group-hover:text-primary transition-all">
                    <Plus className="size-5" />
                  </div>
                  <span className="mt-3 text-xs font-semibold text-neutral-300 group-hover:text-white">
                    New Project
                  </span>
                  <span className="text-[10px] text-neutral-500">Paste URL or drop clip</span>
                </div>
              </>
            )}
          </div>

          {/* Kaydedilmiş Proje Kartları */}
          {filteredProjects.map((proj) => (
            <div
              key={proj.id}
              onClick={() => window.location.assign(projectUrl(proj.id))}
              role="button"
              tabIndex={0}
              className="group relative flex aspect-[4/3] cursor-pointer flex-col justify-between overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/70 p-2.5 transition-all hover:border-neutral-600 hover:bg-neutral-850 hover:shadow-lg"
            >
              {/* Thumbnail / Ekran */}
              <div className="relative flex aspect-video w-full items-center justify-center rounded bg-neutral-950 text-neutral-600 group-hover:text-neutral-400 transition-colors">
                <Film className="size-6" />
                <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.2 font-mono text-[8px] text-neutral-300 uppercase">
                  {proj.source?.platform || "PROJ"}
                </span>
              </div>

              {/* Alt Bilgi */}
              <div className="mt-2 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-neutral-200 group-hover:text-white">
                    {proj.title || proj.source?.title || "Untitled Project"}
                  </span>
                  <span className="block text-[9px] text-neutral-500 font-mono">
                    {new Date(proj.updated_date).toLocaleDateString()}
                  </span>
                </div>

                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      window.open(projectUrl(proj.id), "_blank", "noopener,noreferrer")
                    }}
                    className="p-1 text-neutral-400 hover:text-white"
                    title="Open in new tab"
                  >
                    <ExternalLink className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(proj.id, e)}
                    className="p-1 text-neutral-400 hover:text-red-400"
                    title="Delete"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Alt Durum Çubuğu */}
      <footer className="flex h-7 shrink-0 items-center justify-between border-t border-neutral-800 bg-neutral-950 px-5 text-[10px] font-mono text-neutral-500">
        <div>
          <span>{allProjects.length} Projects in Database</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setCurlOpen(true)}
            className="hover:text-neutral-300"
          >
            cURL Console
          </button>
          <span className="text-emerald-500">● FFmpeg Engine Ready</span>
        </div>
      </footer>

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
