import { useState } from "react"
import {
  ClipboardPaste,
  Clock,
  FileVideo,
  Film,
  Globe,
  Play,
  Terminal,
  Upload,
} from "lucide-react"

import { SourceCurlDialog } from "@/components/app/source-panels"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { projectUrl } from "@/lib/project-route"
import { listProjectWorkspaces } from "@/lib/project-workspace"
import { useSourceResolve, DEMO_URL } from "@/hooks/use-source-resolve"
import { useLocalImportStore } from "@/stores/local-import-store"
import { cn } from "cn"

import { ResolveStatusView } from "./shared"

type DockTool = "url" | "file" | "recents"

export function VariantDock() {
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

  const [activeTool, setActiveTool] = useState<DockTool>("url")
  const [curlOpen, setCurlOpen] = useState(false)

  const recentProjects = listProjectWorkspaces()

  return (
    <div
      data-slot="variant-dock"
      className="relative flex h-full min-h-0 flex-1 flex-col items-center justify-between overflow-y-auto bg-neutral-950 px-4 py-8 select-none"
    >
      {/* Üst Logo ve Başlık */}
      <div className="flex items-center gap-2 text-xs font-semibold text-neutral-300">
        <Film className="size-4 text-primary" />
        <span>ClipStream Studio Palette</span>
        <span className="text-neutral-600">·</span>
        <span className="text-neutral-500 font-mono text-[10px]">Desktop Tool</span>
      </div>

      {/* Orta Kart Tuvali (Seçili Araca Göre Değişir) */}
      <div className="flex w-full max-w-xl flex-col items-center my-auto">
        <div className="w-full rounded-2xl border border-neutral-800 bg-neutral-900/90 p-6 shadow-2xl backdrop-blur-xl">
          {activeTool === "url" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-neutral-200 uppercase tracking-wider flex items-center gap-2">
                  <Globe className="size-4 text-primary" />
                  Stream &amp; Video URL Ingest
                </span>
                <span className="text-[10px] text-neutral-500 font-mono">YouTube · Twitch · TikTok · HLS</span>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void load()
                }}
                className="space-y-3"
              >
                <div className="flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-950 p-1.5">
                  <Input
                    ref={inputRef}
                    autoFocus
                    type="search"
                    placeholder="Paste link to stream or video..."
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    className="h-8 border-0 bg-transparent px-2 text-xs font-mono text-neutral-100 shadow-none focus-visible:ring-0"
                    disabled={resolving}
                  />

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-neutral-400 hover:text-white"
                    onClick={() => void paste()}
                    disabled={resolving}
                  >
                    <ClipboardPaste className="size-3.5 mr-1" />
                    Paste
                  </Button>

                  <Button
                    type="submit"
                    size="sm"
                    className="h-7 bg-primary text-primary-foreground font-bold text-xs px-3"
                    disabled={!inputUrl.trim() || resolving}
                  >
                    Load
                  </Button>
                </div>
              </form>
            </div>
          )}

          {activeTool === "file" && (
            <div
              onClick={() => void pickFile()}
              role="button"
              tabIndex={0}
              className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-neutral-700 bg-neutral-950/60 p-8 text-center transition-all hover:border-primary hover:bg-neutral-950"
            >
              <div className="flex size-12 items-center justify-center rounded-2xl bg-neutral-800 text-primary mb-3">
                <Upload className="size-6" />
              </div>
              <span className="text-xs font-bold text-neutral-200">Select Local Video File</span>
              <span className="text-[10px] text-neutral-500 mt-1">MP4, MKV, MOV, WebM (Instant lossless remux)</span>
              <Button size="sm" variant="secondary" className="mt-4 text-xs">
                Browse Files
              </Button>
            </div>
          )}

          {activeTool === "recents" && (
            <div className="space-y-3">
              <span className="text-xs font-bold text-neutral-200 uppercase tracking-wider flex items-center gap-2">
                <Clock className="size-4 text-amber-500" />
                Recent Workspaces ({recentProjects.length})
              </span>

              <div className="max-h-56 overflow-y-auto space-y-1.5">
                {recentProjects.length === 0 ? (
                  <div className="py-6 text-center text-xs text-neutral-600">No recent projects yet.</div>
                ) : (
                  recentProjects.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => window.location.assign(projectUrl(p.id))}
                      role="button"
                      tabIndex={0}
                      className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-950 p-2.5 text-xs text-neutral-300 hover:bg-neutral-800 cursor-pointer"
                    >
                      <span className="truncate font-medium">{p.title || p.source?.title || "Untitled Project"}</span>
                      <span className="text-[10px] text-neutral-500 shrink-0 ml-2">
                        {new Date(p.updated_date).toLocaleDateString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* İlerleme Paneli */}
          <div className="mt-3">
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
      </div>

      {/* Alt Yüzen Araç Çubuğu (macOS Utility Dock) */}
      <div className="mb-4 flex items-center gap-2 rounded-2xl border border-neutral-800 bg-neutral-900/90 p-2 shadow-2xl backdrop-blur-xl">
        <button
          type="button"
          onClick={() => setActiveTool("url")}
          className={cn(
            "group relative flex size-11 items-center justify-center rounded-xl transition-all",
            activeTool === "url"
              ? "bg-primary text-primary-foreground shadow-md scale-105"
              : "text-neutral-400 hover:bg-neutral-800 hover:text-white",
          )}
          title="Stream / URL Ingest"
        >
          <Globe className="size-5" />
          {activeTool === "url" && (
            <span className="absolute -bottom-1 size-1 rounded-full bg-primary-foreground" />
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTool("file")
            void pickFile()
          }}
          className={cn(
            "group relative flex size-11 items-center justify-center rounded-xl transition-all",
            activeTool === "file"
              ? "bg-primary text-primary-foreground shadow-md scale-105"
              : "text-neutral-400 hover:bg-neutral-800 hover:text-white",
          )}
          title="Open Local Video"
        >
          <FileVideo className="size-5" />
          {activeTool === "file" && (
            <span className="absolute -bottom-1 size-1 rounded-full bg-primary-foreground" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTool("recents")}
          className={cn(
            "group relative flex size-11 items-center justify-center rounded-xl transition-all",
            activeTool === "recents"
              ? "bg-primary text-primary-foreground shadow-md scale-105"
              : "text-neutral-400 hover:bg-neutral-800 hover:text-white",
          )}
          title="Recent Workspaces"
        >
          <Clock className="size-5" />
          {activeTool === "recents" && (
            <span className="absolute -bottom-1 size-1 rounded-full bg-primary-foreground" />
          )}
        </button>

        <div className="h-6 w-px bg-neutral-800 mx-1" />

        <button
          type="button"
          onClick={() => void load(DEMO_URL)}
          className="flex size-11 items-center justify-center rounded-xl text-neutral-400 hover:bg-neutral-800 hover:text-emerald-400 transition-colors"
          title="Sample Reel"
        >
          <Play className="size-5 fill-current" />
        </button>

        <button
          type="button"
          onClick={() => setCurlOpen(true)}
          className="flex size-11 items-center justify-center rounded-xl text-neutral-400 hover:bg-neutral-800 hover:text-amber-400 transition-colors"
          title="cURL Headers"
        >
          <Terminal className="size-5" />
        </button>
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
