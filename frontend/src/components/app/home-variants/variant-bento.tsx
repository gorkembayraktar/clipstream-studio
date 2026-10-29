import { useState } from "react"
import {
  CheckCircle2,
  ClipboardPaste,
  Cpu,
  FileVideo2,
  Link2,
  Loader2,
  Play,
  ShieldCheck,
  Terminal,
  Upload,
  Zap,
} from "lucide-react"

import { SourceCurlDialog } from "@/components/app/source-panels"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { projectUrl } from "@/lib/project-route"
import { listProjectWorkspaces } from "@/lib/project-workspace"
import { useSourceResolve, DEMO_URL } from "@/hooks/use-source-resolve"
import { useLocalImportStore } from "@/stores/local-import-store"
import { cn } from "cn"

import { ResolveStatusView, StudioSecurityPill, SUPPORTED_PLATFORMS } from "./shared"

export function VariantBento() {
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
      data-slot="variant-bento"
      className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-8 sm:px-8 sm:py-10"
    >
      <div className="mx-auto w-full max-w-5xl">
        {/* Başlık */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              ClipStream Bento Studio
            </h1>
            <p className="text-xs text-muted-foreground">
              Modular, hardware-accelerated clipping & streaming suite
            </p>
          </div>

          <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-card px-3 py-1 text-xs text-muted-foreground">
            <span className="size-2 rounded-full bg-emerald-500" />
            <span>Local Machine Engine</span>
          </div>
        </div>

        {/* Bento Izgara Yapısı (Bento Grid) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* KUTU 1: Ana Giriş (2 Kolon Genişliğinde) */}
          <div className="relative flex flex-col justify-between rounded-3xl border border-border/80 bg-card p-6 shadow-sm sm:col-span-2">
            <div>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  <Zap className="size-3.5" />
                  Fast Video Ingest
                </span>
                <span className="text-[11px] text-muted-foreground">
                  YouTube · Twitch · TikTok · HLS
                </span>
              </div>

              <h2 className="mt-3 text-lg font-bold text-foreground">
                Paste any video link or live stream
              </h2>
              <p className="text-xs text-muted-foreground">
                Resolves automatically with frame-accurate trim markers and audio tracks.
              </p>

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void load()
                }}
                className="mt-4"
              >
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-2xl border bg-background px-3 py-1.5 shadow-xs transition-all",
                    focused
                      ? "border-primary ring-2 ring-primary/20"
                      : "border-border/80 hover:border-border",
                  )}
                >
                  <Link2 className="size-4 shrink-0 text-muted-foreground" />
                  <Input
                    ref={inputRef}
                    type="search"
                    className="h-10 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0"
                    placeholder="https://www.youtube.com/watch?v=... or stream link"
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
                    className="h-8 text-xs text-muted-foreground"
                    onClick={() => void paste()}
                    disabled={resolving}
                  >
                    <ClipboardPaste className="size-3.5 mr-1" />
                    Paste
                  </Button>

                  <Button
                    type="submit"
                    size="sm"
                    className="h-8 gap-1.5 text-xs font-semibold px-4"
                    disabled={!inputUrl.trim() || resolving}
                  >
                    {resolving ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Play className="size-3.5 fill-current" />
                    )}
                    <span>Load</span>
                  </Button>
                </div>
              </form>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between border-t border-border/40 pt-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setCurlOpen(true)}
                  className="flex items-center gap-1 hover:text-foreground"
                  disabled={resolving}
                >
                  <Terminal className="size-3.5 text-amber-500" />
                  <span>cURL Headers</span>
                </button>
                <button
                  type="button"
                  onClick={() => void load(DEMO_URL)}
                  className="hover:text-foreground"
                  disabled={resolving}
                >
                  <span>Test Sample Clip</span>
                </button>
              </div>

              <span className="text-[11px]">Instant Lossless Cut</span>
            </div>
          </div>

          {/* KUTU 2: Yerel Dosya Hedefi */}
          <div
            onClick={() => void pickFile()}
            role="button"
            tabIndex={0}
            className="group flex cursor-pointer flex-col justify-between rounded-3xl border border-dashed border-border/80 bg-card p-6 shadow-sm transition-all hover:border-primary/60 hover:bg-primary/5"
          >
            <div>
              <div className="flex size-10 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500 group-hover:scale-105 transition-transform">
                <Upload className="size-5" />
              </div>

              <h3 className="mt-4 text-base font-bold text-foreground">
                Local Video File
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Drop your MP4, MKV, MOV or click to browse.
              </p>
            </div>

            <div className="mt-6 flex items-center justify-between text-xs">
              <span className="text-[11px] text-muted-foreground">Zero re-encode delay</span>
              <span className="font-semibold text-primary group-hover:underline">
                Browse Files →
              </span>
            </div>
          </div>

          {/* KUTU 3: Donanım Hızlandırma Özeti */}
          <div className="flex flex-col justify-between rounded-3xl border border-border/80 bg-card p-6 shadow-sm">
            <div>
              <div className="flex size-10 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500">
                <Cpu className="size-5" />
              </div>

              <h3 className="mt-3 text-sm font-bold text-foreground">
                Hardware Pipeline
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                GPU acceleration ready with NVENC, QSV and Apple Silicon VideoToolbox.
              </p>
            </div>

            <div className="mt-4 flex items-center gap-2 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
              <CheckCircle2 className="size-3.5" />
              <span>FFmpeg 7 Remux Active</span>
            </div>
          </div>

          {/* KUTU 4: Gizlilik & Yerel Depolama */}
          <div className="flex flex-col justify-between rounded-3xl border border-border/80 bg-card p-6 shadow-sm">
            <div>
              <div className="flex size-10 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-500">
                <ShieldCheck className="size-5" />
              </div>

              <h3 className="mt-3 text-sm font-bold text-foreground">
                100% Private & Local
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Files never leave your computer. No cloud upload or external accounts required.
              </p>
            </div>

            <span className="mt-4 text-[11px] text-muted-foreground font-mono">
              localhost:8765
            </span>
          </div>

          {/* KUTU 5: Desteklenen Servisler */}
          <div className="flex flex-col justify-between rounded-3xl border border-border/80 bg-card p-6 shadow-sm">
            <div>
              <div className="flex size-10 items-center justify-center rounded-2xl bg-purple-500/10 text-purple-500">
                <FileVideo2 className="size-5" />
              </div>

              <h3 className="mt-3 text-sm font-bold text-foreground">
                Source Coverage
              </h3>
              <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                {SUPPORTED_PLATFORMS.slice(0, 6).map((plat) => (
                  <span key={plat} className="rounded bg-muted px-1.5 py-0.5">
                    {plat}
                  </span>
                ))}
              </div>
            </div>

            <span className="mt-4 text-[11px] text-primary font-medium">
              yt-dlp + Direct HLS
            </span>
          </div>
        </div>

        {/* İlerleme Paneli */}
        <div className="mt-5">
          <ResolveStatusView
            resolving={resolving}
            progress={progress}
            stage={stage}
            detail={detail}
            onCancel={cancel}
            hasInputUrl={Boolean(inputUrl)}
          />
        </div>

        {/* KUTU 6: Son Projeler (Geniş Alt Bölüm) */}
        {recentProjects.length > 0 && (
          <div className="mt-8 rounded-3xl border border-border/80 bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-foreground">
                  Saved Sessions ({recentProjects.length})
                </h3>
                <p className="text-xs text-muted-foreground">
                  Continue editing your previous clips
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {recentProjects.slice(0, 4).map((proj) => (
                <div
                  key={proj.id}
                  onClick={() => window.location.assign(projectUrl(proj.id))}
                  role="button"
                  tabIndex={0}
                  className="group flex flex-col justify-between rounded-2xl border border-border/60 bg-background p-3.5 transition-all hover:border-primary/50 hover:shadow-sm cursor-pointer"
                >
                  <div>
                    <span className="text-[10px] font-mono uppercase text-muted-foreground">
                      {proj.source?.platform || "clip"}
                    </span>
                    <h4 className="mt-1 line-clamp-1 text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                      {proj.title || proj.source?.title || "Untitled Project"}
                    </h4>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
                    <span>{new Date(proj.updated_date).toLocaleDateString()}</span>
                    <span className="font-semibold text-primary">Open →</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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
