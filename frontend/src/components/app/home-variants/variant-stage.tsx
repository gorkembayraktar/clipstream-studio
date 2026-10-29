import { useState, type DragEvent } from "react"
import {
  ClipboardPaste,
  FileVideo,
  Film,
  Maximize2,
  Play,
  RotateCcw,
  Terminal,
  Upload,
  Volume2,
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

export function VariantStage() {
  const pickFile = useLocalImportStore((s) => s.pickFile)
  const importFile = useLocalImportStore((s) => s.importFile)

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
  const [isDragOver, setIsDragOver] = useState(false)

  const recentProjects = listProjectWorkspaces()

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      void importFile(e.dataTransfer.files[0])
    }
  }

  return (
    <div
      data-slot="variant-stage"
      className="flex h-full min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto bg-neutral-950 font-mono text-neutral-200 select-none p-4 sm:p-8"
    >
      <div className="flex w-full max-w-4xl flex-col items-center">
        {/* 16:9 Profesyonel Monitör Sahnesi (Cinema Stage) */}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragOver(true)
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          className={cn(
            "relative flex aspect-video w-full flex-col justify-between overflow-hidden rounded-2xl border bg-black shadow-2xl transition-all duration-300",
            isDragOver
              ? "border-primary ring-4 ring-primary/20 scale-[1.01]"
              : "border-neutral-800",
          )}
        >
          {/* Monitör Üst HUD Göstergesi */}
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-neutral-900 bg-neutral-950/80 px-4 text-[10px] text-neutral-400">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-emerald-500" />
              <span className="font-bold text-neutral-200">STAGE MONITOR 1</span>
              <span>·</span>
              <span>1920x1080 @ 60 FPS</span>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-emerald-400">TC: 00:00:00:00</span>
              <Maximize2 className="size-3 text-neutral-500" />
            </div>
          </div>

          {/* Monitör Orta Tuvali (Link veya Video Bırakma) */}
          <div className="relative flex flex-1 flex-col items-center justify-center p-6 text-center">
            {/* Ortadaki Hedef */}
            <div className="flex size-14 items-center justify-center rounded-2xl bg-neutral-900/80 text-neutral-400 border border-neutral-800 mb-3 shadow-inner">
              <Upload className="size-6 text-primary" />
            </div>

            <span className="text-xs font-bold text-neutral-200 uppercase tracking-wider">
              Drop Video Into Monitor or Ingest Stream
            </span>
            <span className="text-[10px] text-neutral-500 mt-0.5">
              YouTube, Twitch, TikTok, Kick, HLS .m3u8, MP4, MKV
            </span>

            {/* Entegre Link Girişi */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void load()
              }}
              className="mt-5 flex w-full max-w-md items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950/90 p-1.5 shadow-lg"
            >
              <Input
                ref={inputRef}
                type="search"
                placeholder="Paste video URL..."
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                className="h-8 border-0 bg-transparent px-2 text-xs font-mono text-neutral-100 shadow-none focus-visible:ring-0 placeholder:text-neutral-600"
                disabled={resolving}
              />

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-[10px] text-neutral-400 hover:text-white"
                onClick={() => void paste()}
                disabled={resolving}
              >
                <ClipboardPaste className="size-3 mr-1" />
                Paste
              </Button>

              <Button
                type="submit"
                size="sm"
                className="h-7 bg-primary text-primary-foreground font-bold text-[10px] px-3"
                disabled={!inputUrl.trim() || resolving}
              >
                Load
              </Button>
            </form>

            {/* Hızlı Butonlar */}
            <div className="mt-3 flex items-center gap-2 text-xs">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 border-neutral-800 bg-neutral-900 text-[10px] text-neutral-300"
                onClick={() => void pickFile()}
                disabled={resolving}
              >
                <FileVideo className="size-3 mr-1 text-primary" />
                <span>Browse File</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 border-neutral-800 bg-neutral-900 text-[10px] text-neutral-300"
                onClick={() => setCurlOpen(true)}
                disabled={resolving}
              >
                <Terminal className="size-3 mr-1 text-amber-500" />
                <span>cURL</span>
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] text-neutral-500 hover:text-neutral-300"
                onClick={() => void load(DEMO_URL)}
                disabled={resolving}
              >
                <span>Demo Reel</span>
              </Button>
            </div>
          </div>

          {/* Monitör Alt Kontrol Şeridi (Playback Transport Bar) */}
          <div className="flex h-10 shrink-0 items-center justify-between border-t border-neutral-900 bg-neutral-950/80 px-4 text-xs text-neutral-400">
            <div className="flex items-center gap-3">
              <button type="button" className="text-neutral-500 hover:text-white">
                <Play className="size-3.5 fill-current" />
              </button>
              <button type="button" className="text-neutral-500 hover:text-white">
                <RotateCcw className="size-3" />
              </button>
              <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[9px] font-mono text-neutral-400">
                IN [I]
              </span>
              <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[9px] font-mono text-neutral-400">
                OUT [O]
              </span>
            </div>

            {/* Simüle Edilmiş Boş Timeline */}
            <div className="h-1 flex-1 mx-6 rounded-full bg-neutral-800" />

            <div className="flex items-center gap-2 text-[10px]">
              <Volume2 className="size-3 text-neutral-500" />
              <span>100%</span>
            </div>
          </div>
        </div>

        {/* İlerleme Paneli */}
        {(resolving || inputUrl) && (
          <div className="mt-4 w-full">
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

        {/* Alt Kayıtlı Proje Makaraları */}
        {recentProjects.length > 0 && (
          <div className="mt-6 w-full">
            <div className="mb-2 flex items-center justify-between text-xs text-neutral-400 font-bold uppercase">
              <span className="flex items-center gap-2">
                <Film className="size-3.5 text-primary" />
                Screening Reels ({recentProjects.length})
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {recentProjects.slice(0, 4).map((proj) => (
                <div
                  key={proj.id}
                  onClick={() => window.location.assign(projectUrl(proj.id))}
                  role="button"
                  tabIndex={0}
                  className="group flex flex-col justify-between rounded-xl border border-neutral-800 bg-neutral-900/50 p-2.5 transition-colors hover:border-neutral-700 hover:bg-neutral-900 cursor-pointer"
                >
                  <span className="truncate text-xs font-semibold text-neutral-200 group-hover:text-white">
                    {proj.title || proj.source?.title || "Untitled Reel"}
                  </span>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-neutral-500">
                    <span>{new Date(proj.updated_date).toLocaleDateString()}</span>
                    <span className="text-primary font-bold">LOAD &gt;</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
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
