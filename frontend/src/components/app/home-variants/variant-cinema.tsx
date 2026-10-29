import { useState } from "react"
import {
  Clapperboard,
  ClipboardPaste,
  FileVideo,
  Film,
  Link2,
  Loader2,
  Play,
  Terminal,
} from "lucide-react"

import { SourceCurlDialog } from "@/components/app/source-panels"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/i18n"
import { projectUrl } from "@/lib/project-route"
import { listProjectWorkspaces } from "@/lib/project-workspace"
import { useSourceResolve, DEMO_URL } from "@/hooks/use-source-resolve"
import { useLocalImportStore } from "@/stores/local-import-store"
import { cn } from "cn"

import { ResolveStatusView, StudioSecurityPill } from "./shared"

export function VariantCinema() {
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
  const [focused, setFocused] = useState(false)

  const recentProjects = listProjectWorkspaces()

  return (
    <div
      data-slot="variant-cinema"
      className="relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-neutral-950 text-neutral-100 px-4 py-8 sm:px-8"
    >
      <div className="mx-auto w-full max-w-5xl">
        {/* Sinema Başlığı ve Zaman Kodu Göstergesi */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-neutral-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-red-600/20 text-red-500 border border-red-500/30">
              <Clapperboard className="size-5" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-neutral-100 flex items-center gap-2">
                <span>CINEMA TIMELINE CANVAS</span>
                <span className="size-1.5 rounded-full bg-red-500 animate-pulse" />
              </h1>
              <p className="text-xs text-neutral-400">
                Frame-accurate clipper · Lossless stream remux
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs">
            <div className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1 text-emerald-400">
              TC: 00:00:00:00
            </div>
            <div className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-neutral-400">
              60.00 FPS
            </div>
            <div className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-neutral-400">
              1080p · REC.709
            </div>
          </div>
        </div>

        {/* Hayalet Zaman Çizelgesi (Ghost Timeline Track) */}
        <div className="relative rounded-2xl border border-neutral-800 bg-neutral-900/90 shadow-2xl p-5 backdrop-blur-md">
          {/* Zaman Çizelgesi Cetveli (Timecode Ruler) */}
          <div className="relative mb-3 h-6 border-b border-neutral-800 text-[10px] font-mono text-neutral-500 flex justify-between select-none">
            <span>00:00.00</span>
            <span className="hidden sm:inline">00:15.00</span>
            <span>00:30.00</span>
            <span className="hidden sm:inline">00:45.00</span>
            <span>01:00.00</span>
            <span className="hidden sm:inline">01:30.00</span>
            <span>02:00.00</span>
          </div>

          {/* Video Kanalı (V1 Track Lane) - Giriş Formu Buraya Entegre! */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-mono text-neutral-400">
              <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300 font-bold">
                V1
              </span>
              <span>VIDEO INGEST LANE</span>
            </div>

            {/* Video Parçası Şeklinde Giriş Kartı */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void load()
              }}
              className={cn(
                "relative rounded-xl border p-2 transition-all duration-200",
                focused
                  ? "border-primary bg-neutral-800/90 ring-1 ring-primary/40"
                  : "border-neutral-700 bg-neutral-800/50 hover:border-neutral-600",
              )}
            >
              <div className="flex items-center gap-2">
                <Link2 className="size-4 shrink-0 text-primary ml-1" />
                <Input
                  ref={inputRef}
                  type="search"
                  className="h-10 border-0 bg-transparent px-1 font-mono text-xs sm:text-sm text-neutral-100 shadow-none focus-visible:ring-0 placeholder:text-neutral-500"
                  placeholder="Paste URL (YouTube, Twitch, TikTok, Kick, HLS stream) or drop video file..."
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
                  className="h-8 text-xs text-neutral-300 hover:bg-neutral-700"
                  onClick={() => void paste()}
                  disabled={resolving}
                >
                  <ClipboardPaste className="size-3.5 mr-1" />
                  {t("source.paste")}
                </Button>

                <Button
                  type="submit"
                  size="sm"
                  className="h-8 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold px-4"
                  disabled={!inputUrl.trim() || resolving}
                >
                  {resolving ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5 fill-current mr-1" />
                  )}
                  <span>LOAD TRACK</span>
                </Button>
              </div>
            </form>

            {/* Ses Kanalı (A1 Track Lane) */}
            <div className="mt-3 flex items-center justify-between rounded-xl border border-neutral-800/80 bg-neutral-950/60 p-3 text-xs font-mono">
              <div className="flex items-center gap-3">
                <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300 font-bold">
                  A1
                </span>
                <span className="text-neutral-400">STEREO AUDIO (192K AAC)</span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 border-neutral-700 bg-neutral-800 text-xs text-neutral-200 hover:bg-neutral-700"
                  onClick={() => void pickFile()}
                  disabled={resolving}
                >
                  <FileVideo className="size-3 text-emerald-400 mr-1.5" />
                  <span>Browse File</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 border-neutral-700 bg-neutral-800 text-xs text-neutral-200 hover:bg-neutral-700"
                  onClick={() => setCurlOpen(true)}
                  disabled={resolving}
                >
                  <Terminal className="size-3 text-amber-400 mr-1.5" />
                  <span>cURL</span>
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-neutral-400 hover:text-neutral-200"
                  onClick={() => void load(DEMO_URL)}
                  disabled={resolving}
                >
                  <span>Test Reel</span>
                </Button>
              </div>
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

        {/* Makara Geçmişi / Projeler */}
        <div className="mt-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-bold tracking-wider text-neutral-400 uppercase font-mono flex items-center gap-2">
              <Film className="size-4 text-red-500" />
              <span>SAVED PRODUCTION REELS ({recentProjects.length})</span>
            </h2>
          </div>

          {recentProjects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-800 p-8 text-center text-xs font-mono text-neutral-500">
              No project reels found. Insert a video URL or drop a local file on V1 track.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recentProjects.slice(0, 6).map((proj) => (
                <div
                  key={proj.id}
                  onClick={() => window.location.assign(projectUrl(proj.id))}
                  role="button"
                  tabIndex={0}
                  className="group flex flex-col justify-between rounded-xl border border-neutral-800 bg-neutral-900/60 p-3.5 transition-all hover:border-neutral-700 hover:bg-neutral-900 cursor-pointer"
                >
                  <div>
                    <div className="flex items-center justify-between text-[10px] font-mono text-neutral-500">
                      <span className="uppercase text-red-400">
                        {proj.source?.platform || "MASTER"}
                      </span>
                      <span>{new Date(proj.updated_date).toLocaleDateString()}</span>
                    </div>

                    <h3 className="mt-1.5 line-clamp-1 text-xs font-semibold text-neutral-200 group-hover:text-white">
                      {proj.title || proj.source?.title || "Untitled Project"}
                    </h3>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-neutral-800 pt-2 text-[10px] font-mono text-neutral-400">
                    <span>{proj.edit?.segments?.length || 1} cuts</span>
                    <span className="text-red-400 group-hover:underline flex items-center gap-1">
                      OPEN TIMELINE →
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-10">
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
