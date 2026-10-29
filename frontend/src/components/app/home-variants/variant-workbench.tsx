import { useState } from "react"
import {
  ClipboardPaste,
  Disc,
  FileVideo,
  Film,
  Play,
  Scissors,
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

export function VariantWorkbench() {
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

  const recentProjects = listProjectWorkspaces()

  return (
    <div
      data-slot="variant-workbench"
      className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-neutral-950 font-mono text-neutral-200 select-none p-4 sm:p-8"
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        {/* Üst Düz Montaj Masası Başlığı (Steenbeck Header) */}
        <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 items-center justify-center rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">
              <Scissors className="size-4" />
            </div>
            <div>
              <span className="text-xs font-bold tracking-wider text-neutral-100 uppercase">
                STEENBECK EDITING FLATBED
              </span>
              <span className="block text-[9px] text-neutral-500">
                Moviola Splicing Table · Frame Accurate Remux
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-[10px] text-neutral-500">
            <span>GAUGE: 35MM / 1080P</span>
            <span>·</span>
            <span className="text-amber-500 font-bold">FLATBED MOTOR ACTIVE</span>
          </div>
        </div>

        {/* 35mm Film Makaraları Şeridi (Recent Project Reels on Top Spools) */}
        {recentProjects.length > 0 && (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-2.5 flex items-center gap-1.5">
              <Disc className="size-3.5 text-amber-500" />
              Spliced Reels on Spindle ({recentProjects.length})
            </span>

            <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none]">
              {recentProjects.slice(0, 6).map((proj, idx) => (
                <div
                  key={proj.id}
                  onClick={() => window.location.assign(projectUrl(proj.id))}
                  role="button"
                  tabIndex={0}
                  className="group flex w-44 shrink-0 flex-col justify-between rounded-xl border border-neutral-800 bg-neutral-950 p-3 transition-all hover:border-amber-500/60 hover:bg-neutral-900 cursor-pointer"
                >
                  <div className="flex items-center justify-between text-[9px] text-neutral-500">
                    <span className="font-bold text-amber-500 font-mono">REEL #{idx + 1}</span>
                    <span>{new Date(proj.updated_date).toLocaleDateString()}</span>
                  </div>

                  <span className="mt-2 block truncate text-xs font-semibold text-neutral-200 group-hover:text-white">
                    {proj.title || proj.source?.title || "Untitled Reel"}
                  </span>

                  <div className="mt-3 flex items-center justify-between border-t border-neutral-900 pt-1.5 text-[9px] text-neutral-500">
                    <span>{proj.edit?.segments?.length || 1} cuts</span>
                    <span className="text-amber-500 group-hover:underline">Mount &gt;</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Işıklı Montaj Masası ve Bant Yuvası (Center Light Table & Splicer) */}
        <div className="relative rounded-2xl border border-neutral-800 bg-neutral-900/90 p-6 shadow-2xl backdrop-blur-md">
          {/* Splicing Slot Form */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-200 uppercase tracking-wider flex items-center gap-2">
                <Film className="size-4 text-amber-500" />
                Insert Video Feed or Stream Tape
              </span>
              <span className="text-[10px] text-neutral-500">YouTube · Twitch · Kick · Local</span>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                void load()
              }}
              className="flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-950 p-2 shadow-inner"
            >
              <Input
                ref={inputRef}
                type="search"
                placeholder="Feed URL (YouTube, Twitch, TikTok, HLS .m3u8)..."
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                className="h-9 border-0 bg-transparent px-2 text-xs font-mono text-neutral-100 shadow-none focus-visible:ring-0 placeholder:text-neutral-600"
                disabled={resolving}
              />

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-neutral-400 hover:text-white"
                onClick={() => void paste()}
                disabled={resolving}
              >
                <ClipboardPaste className="size-3.5 mr-1" />
                Paste
              </Button>

              <Button
                type="submit"
                size="sm"
                className="h-8 bg-amber-600 hover:bg-amber-500 text-black font-bold text-xs px-4"
                disabled={!inputUrl.trim() || resolving}
              >
                SPLICE &amp; LOAD
              </Button>
            </form>

            {/* Hızlı Montaj Aletleri */}
            <div className="flex flex-wrap items-center justify-between border-t border-neutral-800 pt-4 text-xs">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 border-neutral-800 bg-neutral-950 text-xs text-neutral-300 hover:border-neutral-700"
                  onClick={() => void pickFile()}
                  disabled={resolving}
                >
                  <FileVideo className="size-3 mr-1.5 text-amber-500" />
                  <span>Mount Local Reel</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 border-neutral-800 bg-neutral-950 text-xs text-neutral-300 hover:border-neutral-700"
                  onClick={() => setCurlOpen(true)}
                  disabled={resolving}
                >
                  <Terminal className="size-3 mr-1.5 text-neutral-400" />
                  <span>cURL Stream</span>
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-neutral-500 hover:text-neutral-300"
                  onClick={() => void load(DEMO_URL)}
                  disabled={resolving}
                >
                  <Play className="size-3 fill-current mr-1 text-emerald-400" />
                  <span>Test Feed</span>
                </Button>
              </div>

              <span className="text-[10px] text-neutral-500">Lossless Cutting Enabled</span>
            </div>
          </div>

          {/* İlerleme Paneli */}
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
        </div>

        {/* Alt Tezgah Bilgi Çubuğu */}
        <div className="flex items-center justify-between text-[10px] text-neutral-600 border-t border-neutral-900 pt-3">
          <span>ClipStream Workbench v0.2.14</span>
          <span>Zero cloud dependency · Local FFmpeg pipeline</span>
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
