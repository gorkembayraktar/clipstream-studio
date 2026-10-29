import { useState } from "react"
import {
  ClipboardPaste,
  FileVideo,
  Film,
  Globe,
  Loader2,
  Play,
  Radio,
  Sparkles,
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

type IslandMode = "url" | "file" | "stream"

export function VariantIsland() {
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

  const [mode, setMode] = useState<IslandMode>("url")
  const [curlOpen, setCurlOpen] = useState(false)
  const [focused, setFocused] = useState(false)

  const recentProjects = listProjectWorkspaces().slice(0, 6)

  return (
    <div
      data-slot="variant-island"
      className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-10 sm:px-8"
    >
      {/* Arka Plan Sinematik Işık Halkası */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
      >
        <div className="size-[420px] rounded-full bg-gradient-to-tr from-primary/15 via-chart-2/10 to-transparent blur-3xl" />
      </div>

      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center">
        {/* Üst Karşılama Rozeti */}
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/80 px-3.5 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur-md">
          <Sparkles className="size-3 text-primary animate-spin" />
          <span className="font-medium text-foreground">ClipStream Island</span>
          <span className="text-border">·</span>
          <span>Instant Video Engine</span>
        </div>

        {/* Ana Dinamik Kapsül (Dynamic Island) */}
        <div
          className={cn(
            "relative w-full rounded-3xl border bg-card/95 p-3 shadow-2xl backdrop-blur-2xl transition-all duration-300",
            focused
              ? "border-primary/80 ring-4 ring-primary/10 shadow-primary/10 scale-[1.01]"
              : "border-border/90 hover:border-border hover:shadow-xl",
          )}
        >
          {/* Kapsül İçi Mod Değiştirici */}
          <div className="mb-3 flex items-center justify-between border-b border-border/40 pb-2.5 px-2">
            <div className="flex items-center gap-1 rounded-full bg-muted/50 p-1">
              <button
                type="button"
                onClick={() => setMode("url")}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all",
                  mode === "url"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Globe className="size-3.5" />
                <span>Web URL</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode("file")
                  void pickFile()
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all",
                  mode === "file"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <FileVideo className="size-3.5" />
                <span>Local File</span>
              </button>

              <button
                type="button"
                onClick={() => setMode("stream")}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all",
                  mode === "stream"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Radio className="size-3.5 text-rose-500" />
                <span>Live Stream</span>
              </button>
            </div>

            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <button
                type="button"
                onClick={() => setCurlOpen(true)}
                className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted"
                title="cURL headers"
              >
                <Terminal className="size-3" />
                cURL
              </button>
            </div>
          </div>

          {/* Akıllı Giriş Çubuğu */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void load()
            }}
            className="flex items-center gap-2 px-2"
          >
            <div className="relative flex flex-1 items-center">
              <Input
                ref={inputRef}
                type="search"
                className="h-12 border-0 bg-transparent px-2 text-sm sm:text-base font-medium shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/50"
                placeholder={
                  mode === "stream"
                    ? "Paste HLS .m3u8, RTMP or Twitch stream..."
                    : "Paste YouTube, Twitch, TikTok, Kick or video link..."
                }
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                disabled={resolving}
              />
            </div>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-10 rounded-xl px-3 text-xs"
              onClick={() => void paste()}
              disabled={resolving}
            >
              <ClipboardPaste className="size-3.5 mr-1" />
              <span>{t("source.paste")}</span>
            </Button>

            <Button
              type="submit"
              size="sm"
              className="h-10 rounded-xl px-5 text-xs font-semibold shadow-md"
              disabled={!inputUrl.trim() || resolving}
            >
              {resolving ? (
                <>
                  <Loader2 className="size-3.5 animate-spin mr-1.5" />
                  <span>{t("source.resolving")}</span>
                </>
              ) : (
                <>
                  <Play className="size-3.5 fill-current mr-1.5" />
                  <span>Start Clip</span>
                </>
              )}
            </Button>
          </form>

          {/* Hızlı Demo Çubuğu */}
          <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2 px-3 text-xs text-muted-foreground">
            <span>Instant Remux · Hardware NVENC/QSV</span>
            <button
              type="button"
              onClick={() => void load(DEMO_URL)}
              className="text-primary hover:underline"
              disabled={resolving}
            >
              Try sample video →
            </button>
          </div>
        </div>

        {/* İlerleme Paneli */}
        <div className="mt-5 w-full">
          <ResolveStatusView
            resolving={resolving}
            progress={progress}
            stage={stage}
            detail={detail}
            onCancel={cancel}
            hasInputUrl={Boolean(inputUrl)}
          />
        </div>

        {/* Sinematik 35mm Film Şeridi (Son Projeler) */}
        {recentProjects.length > 0 && (
          <div className="mt-10 w-full">
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground uppercase tracking-wider">
                <Film className="size-3.5 text-primary" />
                Filmstrip Workspaces
              </span>
              <span className="text-[11px] text-muted-foreground">
                {recentProjects.length} saved reels
              </span>
            </div>

            {/* Delikli Film Şeridi Tasarımı */}
            <div className="relative rounded-2xl border border-border/80 bg-card/60 p-3 shadow-md backdrop-blur-md">
              <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none]">
                {recentProjects.map((proj) => (
                  <div
                    key={proj.id}
                    onClick={() => window.location.assign(projectUrl(proj.id))}
                    role="button"
                    tabIndex={0}
                    className="group relative flex w-48 shrink-0 cursor-pointer flex-col justify-between rounded-xl border border-border/70 bg-background/80 p-3 transition-all hover:border-primary/60 hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span className="uppercase font-mono">
                          {proj.source?.platform || "clip"}
                        </span>
                        <span>{new Date(proj.updated_date).toLocaleDateString()}</span>
                      </div>

                      <h4 className="mt-2 line-clamp-2 text-xs font-medium text-foreground group-hover:text-primary transition-colors">
                        {proj.title || proj.source?.title || "Untitled Reel"}
                      </h4>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
                      <span>{proj.edit?.segments?.length || 1} cuts</span>
                      <span className="flex items-center text-primary group-hover:underline">
                        Resume <Play className="size-2.5 fill-current ml-1" />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
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
