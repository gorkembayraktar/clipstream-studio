import { useState } from "react"
import {
  ArrowRight,
  ClipboardPaste,
  Command,
  FileVideo,
  Film,
  Globe,
  Loader2,
  Play,
  Search,
  Terminal,
} from "lucide-react"

import { SourceCurlDialog } from "@/components/app/source-panels"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { projectUrl } from "@/lib/project-route"
import { listProjectWorkspaces } from "@/lib/project-workspace"
import { useSourceResolve, DEMO_URL } from "@/hooks/use-source-resolve"
import { useLocalImportStore } from "@/stores/local-import-store"

import { ResolveStatusView } from "./shared"

export function VariantHud() {
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
  const [filter, setFilter] = useState("")

  const allProjects = listProjectWorkspaces()

  const filtered = allProjects.filter((p) => {
    if (!filter.trim()) return true
    const q = filter.toLowerCase()
    return (p.title || p.source?.title || "").toLowerCase().includes(q)
  })

  const isUrl =
    inputUrl.startsWith("http://") ||
    inputUrl.startsWith("https://") ||
    inputUrl.includes(".m3u8") ||
    inputUrl.includes("youtu")

  return (
    <div
      data-slot="variant-hud"
      className="flex h-full min-h-0 flex-1 items-center justify-center bg-black/60 p-4"
    >
      {/* Floating Raycast / Spotlight HUD Box */}
      <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-neutral-700/80 bg-neutral-900/95 shadow-2xl backdrop-blur-2xl">
        {/* HUD Komut Girişi */}
        <div className="relative flex items-center border-b border-neutral-800 px-4 py-3">
          <Search className="size-4 shrink-0 text-neutral-400 mr-2.5" />
          <Input
            ref={inputRef}
            autoFocus
            type="search"
            placeholder="Type a video URL, or search saved projects..."
            value={inputUrl}
            onChange={(e) => {
              setInputUrl(e.target.value)
              setFilter(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && inputUrl.trim()) {
                e.preventDefault()
                void load()
              }
            }}
            className="h-9 border-0 bg-transparent px-0 text-sm font-medium text-neutral-100 shadow-none focus-visible:ring-0 placeholder:text-neutral-500"
            disabled={resolving}
          />

          {resolving ? (
            <Loader2 className="size-4 animate-spin text-primary shrink-0" />
          ) : (
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-mono text-neutral-400">
                ESC
              </span>
              <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-mono text-neutral-400">
                ↵ ENTER
              </span>
            </div>
          )}
        </div>

        {/* İlerleme Paneli */}
        {resolving && (
          <div className="p-3 border-b border-neutral-800 bg-neutral-950/60">
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

        {/* HUD Gövdesi (Eylemler + Projeler) */}
        <div className="max-h-[380px] overflow-y-auto p-2 space-y-4">
          {/* Eğer URL girilmişse doğrudan çalıştırma önerisi */}
          {isUrl && (
            <div
              onClick={() => void load()}
              role="button"
              tabIndex={0}
              className="flex items-center justify-between rounded-xl bg-primary/20 border border-primary/40 px-3 py-2.5 text-xs text-white cursor-pointer hover:bg-primary/30"
            >
              <div className="flex items-center gap-2 truncate">
                <Globe className="size-4 text-primary" />
                <span className="font-semibold">Ingest Stream URL:</span>
                <span className="truncate text-neutral-300 font-mono text-[11px]">
                  {inputUrl}
                </span>
              </div>
              <Button size="sm" className="h-6 text-[10px] font-bold">
                Run ↵
              </Button>
            </div>
          )}

          {/* Hızlı Eylemler (Quick Actions) */}
          <div className="space-y-1">
            <span className="px-3 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
              Quick Actions
            </span>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => void pickFile()}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800 text-left transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <FileVideo className="size-4 text-primary" />
                  <span>Open Video File</span>
                </div>
                <span className="text-[10px] font-mono text-neutral-500">Ctrl+O</span>
              </button>

              <button
                type="button"
                onClick={() => void paste()}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800 text-left transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <ClipboardPaste className="size-4 text-emerald-400" />
                  <span>Paste Clipboard</span>
                </div>
                <span className="text-[10px] font-mono text-neutral-500">Ctrl+V</span>
              </button>

              <button
                type="button"
                onClick={() => void load(DEMO_URL)}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800 text-left transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Play className="size-4 text-amber-400 fill-current" />
                  <span>Load Sample Reel</span>
                </div>
                <span className="text-[10px] font-mono text-neutral-500">Demo</span>
              </button>

              <button
                type="button"
                onClick={() => setCurlOpen(true)}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800 text-left transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Terminal className="size-4 text-purple-400" />
                  <span>Custom cURL Stream</span>
                </div>
                <span className="text-[10px] font-mono text-neutral-500">HTTP</span>
              </button>
            </div>
          </div>

          {/* Kaydedilmiş Projeler */}
          <div className="space-y-1">
            <span className="px-3 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
              Recent Projects ({filtered.length})
            </span>

            {filtered.length === 0 ? (
              <div className="py-4 text-center text-xs text-neutral-600">
                No recent workspaces found.
              </div>
            ) : (
              filtered.slice(0, 5).map((p) => (
                <div
                  key={p.id}
                  onClick={() => window.location.assign(projectUrl(p.id))}
                  role="button"
                  tabIndex={0}
                  className="group flex items-center justify-between rounded-lg px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800 hover:text-white cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2.5 truncate pr-2">
                    <Film className="size-3.5 text-neutral-500 group-hover:text-primary" />
                    <span className="truncate font-medium">
                      {p.title || p.source?.title || "Untitled Project"}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 text-[10px] text-neutral-500 font-mono">
                    <span>{new Date(p.updated_date).toLocaleDateString()}</span>
                    <ArrowRight className="size-3 text-neutral-600 group-hover:text-primary" />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Alt Kısayol Bilgi Çubuğu (HUD Footer) */}
        <div className="flex h-8 shrink-0 items-center justify-between border-t border-neutral-800 bg-neutral-950 px-4 text-[10px] font-mono text-neutral-500">
          <div className="flex items-center gap-1.5">
            <Command className="size-3 text-neutral-400" />
            <span>ClipStream Command HUD</span>
          </div>

          <div className="flex items-center gap-3">
            <span>FFmpeg Remux Ready</span>
            <span>·</span>
            <span>Local Machine</span>
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
