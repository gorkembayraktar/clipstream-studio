import { useState } from "react"
import {
  ClipboardPaste,
  Loader2,
  Play,
} from "lucide-react"

import { SourceCurlDialog } from "@/components/app/source-panels"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { projectUrl } from "@/lib/project-route"
import { listProjectWorkspaces } from "@/lib/project-workspace"
import { useSourceResolve, DEMO_URL } from "@/hooks/use-source-resolve"
import { useLocalImportStore } from "@/stores/local-import-store"
import { cn } from "cn"

import { ResolveStatusView, StudioSecurityPill } from "./shared"

export function VariantTerminal() {
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
  const [focused, setFocused] = useState(false)

  const recentProjects = listProjectWorkspaces()

  return (
    <div
      data-slot="variant-terminal"
      className="relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-zinc-950 font-mono text-zinc-200 px-4 py-8 sm:px-8"
    >
      <div className="mx-auto w-full max-w-4xl">
        {/* Terminal Penceresi */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/90 shadow-2xl overflow-hidden backdrop-blur-md">
          {/* Terminal Pencere Başlığı (macOS Noktaları) */}
          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="size-3 rounded-full bg-red-500/80 inline-block" />
              <span className="size-3 rounded-full bg-amber-500/80 inline-block" />
              <span className="size-3 rounded-full bg-emerald-500/80 inline-block" />
              <span className="ml-2 text-xs text-zinc-400">clipstream-cli — session</span>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
              <span>port: 8765</span>
              <span>·</span>
              <span className="text-emerald-400">status: active</span>
            </div>
          </div>

          {/* Terminal Gövdesi */}
          <div className="p-6 space-y-6">
            {/* Karşılama Mesajı */}
            <div className="text-xs text-zinc-400 leading-relaxed space-y-1">
              <p className="text-emerald-400 font-bold">
                ClipStream Studio CLI [Version 0.2.12]
              </p>
              <p>Type a media URL, drop a video file, or use one of the quick flags below.</p>
              <p className="text-zinc-500">
                Supported: YouTube, Twitch, TikTok, Kick, X, HLS (.m3u8), MP4, MKV
              </p>
            </div>

            {/* Komut Satırı / Giriş Alanı */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void load()
              }}
              className="space-y-3"
            >
              <div
                className={cn(
                  "flex items-center gap-2 rounded-xl border bg-black/60 px-3 py-2 transition-all",
                  focused
                    ? "border-emerald-500/80 ring-1 ring-emerald-500/30"
                    : "border-zinc-800 hover:border-zinc-700",
                )}
              >
                <span className="text-emerald-400 font-bold select-none text-xs sm:text-sm">
                  $ clip --ingest
                </span>

                <Input
                  ref={inputRef}
                  type="search"
                  className="h-9 border-0 bg-transparent px-1 font-mono text-xs sm:text-sm text-zinc-100 shadow-none focus-visible:ring-0 placeholder:text-zinc-600"
                  placeholder="https://... or paste link"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  disabled={resolving}
                />

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-zinc-400 hover:text-zinc-200"
                  onClick={() => void paste()}
                  disabled={resolving}
                >
                  <ClipboardPaste className="size-3.5 mr-1" />
                  Paste
                </Button>

                <Button
                  type="submit"
                  size="sm"
                  className="h-7 bg-emerald-600 hover:bg-emerald-500 text-black font-bold text-xs px-3"
                  disabled={!inputUrl.trim() || resolving}
                >
                  {resolving ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3 fill-current mr-1" />
                  )}
                  <span>RUN</span>
                </Button>
              </div>

              {/* Bayraklar / Kısayollar */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-zinc-500 text-[11px]">Quick Flags:</span>
                <button
                  type="button"
                  onClick={() => void pickFile()}
                  className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-zinc-300 hover:border-zinc-600"
                  disabled={resolving}
                >
                  --file (browse local)
                </button>

                <button
                  type="button"
                  onClick={() => setCurlOpen(true)}
                  className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-amber-400 hover:border-zinc-600"
                  disabled={resolving}
                >
                  --curl (headers)
                </button>

                <button
                  type="button"
                  onClick={() => void load(DEMO_URL)}
                  className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-zinc-400 hover:text-zinc-200"
                  disabled={resolving}
                >
                  --sample (demo video)
                </button>
              </div>
            </form>

            {/* İlerleme Çıktısı */}
            <div className="mt-4">
              <ResolveStatusView
                resolving={resolving}
                progress={progress}
                stage={stage}
                detail={detail}
                onCancel={cancel}
                hasInputUrl={Boolean(inputUrl)}
              />
            </div>

            {/* Kaydedilmiş Oturumlar / Projeler Tablosu */}
            <div className="mt-6 border-t border-zinc-800 pt-5">
              <div className="mb-3 flex items-center justify-between text-xs text-zinc-400 font-bold uppercase tracking-wider">
                <span>Recent Workspaces [ls -la]</span>
                <span className="text-zinc-500 font-normal">
                  {recentProjects.length} records found
                </span>
              </div>

              {recentProjects.length === 0 ? (
                <div className="text-xs text-zinc-600 py-4 text-center">
                  Workspace directory is empty. Ingest a stream to create a new session.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {recentProjects.slice(0, 5).map((proj) => (
                    <div
                      key={proj.id}
                      onClick={() => window.location.assign(projectUrl(proj.id))}
                      role="button"
                      tabIndex={0}
                      className="group flex items-center justify-between rounded-lg border border-zinc-850 bg-black/40 px-3 py-2 text-xs transition-colors hover:border-emerald-500/50 hover:bg-zinc-850 cursor-pointer"
                    >
                      <div className="flex items-center gap-3 truncate">
                        <span className="text-emerald-400">❯</span>
                        <span className="font-semibold text-zinc-200 group-hover:text-white truncate">
                          {proj.title || proj.source?.title || "Untitled Project"}
                        </span>
                        <span className="text-[10px] text-zinc-500 hidden sm:inline uppercase">
                          [{proj.source?.platform || "media"}]
                        </span>
                      </div>

                      <div className="flex items-center gap-4 shrink-0 text-[11px] text-zinc-500">
                        <span>{new Date(proj.updated_date).toLocaleDateString()}</span>
                        <span className="text-emerald-400 font-bold group-hover:underline">
                          LOAD →
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 text-center text-xs text-zinc-600">
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
