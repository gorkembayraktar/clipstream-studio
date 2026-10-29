import { useState } from "react"
import {
  ArrowRight,
  ClipboardPaste,
  Clock,
  FileVideo2,
  Globe2,
  Loader2,
  Play,
  Terminal,
  UploadCloud,
} from "lucide-react"

import { RecentProjects } from "@/components/app/recent-projects"
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

export function VariantCards() {
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

  // Son projelerden ilkini çekerek "Devam Et" kartına yerleştirelim
  const recentList = listProjectWorkspaces()
  const latestProject = recentList[0] ?? null

  return (
    <div
      data-slot="variant-cards"
      className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-8 sm:px-8 sm:py-12"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center">
        {/* Başlık Alanı */}
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-4xl">
            Choose how to start clipping
          </h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            Select one of the 3 entry paths below to begin your editing session.
          </p>
        </div>

        {/* 3 Kartlık Başlangıç Izgarası */}
        <div className="mt-8 grid w-full grid-cols-1 gap-5 md:grid-cols-3">
          {/* KART 1: Web & Canlı Akış */}
          <div className="relative flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-5 shadow-sm transition-all hover:border-primary/40 hover:shadow-md">
            <div>
              <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Globe2 className="size-6" />
              </div>

              <h2 className="mt-4 text-base font-semibold text-foreground">
                Web or Live Stream
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                YouTube, Twitch, Kick, TikTok, X or any HLS stream URL.
              </p>

              {/* URL Girişi */}
              <form
                className="mt-4 space-y-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  void load()
                }}
              >
                <div
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1 text-xs transition-all",
                    focused
                      ? "border-primary ring-1 ring-primary/20"
                      : "border-border/80",
                  )}
                >
                  <Input
                    ref={inputRef}
                    type="search"
                    className="h-8 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
                    placeholder="Paste link here..."
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    disabled={resolving}
                  />

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => void paste()}
                    disabled={resolving}
                    title={t("source.paste")}
                  >
                    <ClipboardPaste className="size-3.5" />
                  </Button>
                </div>

                <Button
                  type="submit"
                  size="sm"
                  className="w-full h-8 text-xs font-medium"
                  disabled={!inputUrl.trim() || resolving}
                >
                  {resolving ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      <span>{t("source.resolving")}</span>
                    </>
                  ) : (
                    <>
                      <span>Load Stream</span>
                      <ArrowRight className="size-3.5 ml-1" />
                    </>
                  )}
                </Button>
              </form>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-border/40 pt-3 text-[11px] text-muted-foreground">
              <button
                type="button"
                onClick={() => void load(DEMO_URL)}
                disabled={resolving}
                className="text-primary hover:underline"
              >
                Try sample demo
              </button>
              <button
                type="button"
                onClick={() => setCurlOpen(true)}
                disabled={resolving}
                className="flex items-center gap-1 hover:text-foreground"
              >
                <Terminal className="size-3" />
                cURL
              </button>
            </div>
          </div>

          {/* KART 2: Yerel Video Dosyası */}
          <div
            onClick={() => void pickFile()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") void pickFile()
            }}
            className="group relative flex cursor-pointer flex-col justify-between rounded-2xl border border-dashed border-border/80 bg-card p-5 shadow-sm transition-all hover:border-primary/60 hover:bg-primary/5 hover:shadow-md"
          >
            <div>
              <div className="flex size-11 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 group-hover:scale-105 transition-transform">
                <FileVideo2 className="size-6" />
              </div>

              <h2 className="mt-4 text-base font-semibold text-foreground">
                Local Video File
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Select an MP4, MKV, MOV, WebM video directly from your computer.
              </p>

              <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-border/60 bg-muted/20 py-6 text-center">
                <UploadCloud className="size-6 text-muted-foreground/80 group-hover:text-primary transition-colors" />
                <span className="mt-2 text-xs font-medium text-foreground">
                  Click to browse video file
                </span>
                <span className="text-[10px] text-muted-foreground">
                  or drag and drop anywhere
                </span>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-border/40 pt-3 text-[11px] text-muted-foreground">
              <span>Lossless cutting</span>
              <span className="font-medium text-foreground">Direct Import →</span>
            </div>
          </div>

          {/* KART 3: Önceki Projeye Devam */}
          <div className="relative flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-5 shadow-sm transition-all hover:border-primary/40 hover:shadow-md">
            <div>
              <div className="flex size-11 items-center justify-center rounded-xl bg-sky-500/10 text-sky-500">
                <Clock className="size-6" />
              </div>

              <h2 className="mt-4 text-base font-semibold text-foreground">
                Resume Recent
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Quickly continue where you left off in your latest workspace.
              </p>

              <div className="mt-4">
                {latestProject ? (
                  <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-2">
                    <span className="block truncate text-xs font-semibold text-foreground">
                      {latestProject.title ||
                        latestProject.source?.title ||
                        "Untitled Project"}
                    </span>
                    <span className="block text-[10px] text-muted-foreground">
                      {new Date(latestProject.updated_date).toLocaleDateString()}
                      {latestProject.source?.isLive ? " · Live Stream" : ""}
                    </span>

                    <Button
                      type="button"
                      size="sm"
                      className="w-full h-8 text-xs mt-2 gap-1.5"
                      onClick={() =>
                        window.location.assign(projectUrl(latestProject.id))
                      }
                    >
                      <Play className="size-3.5 fill-current" />
                      <span>Resume Session</span>
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-xl border border-border/60 bg-muted/10 p-5 text-center text-xs text-muted-foreground">
                    No recent workspaces yet. Load a link to start.
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-border/40 pt-3 text-[11px] text-muted-foreground">
              <span>{recentList.length} saved sessions</span>
              <span className="text-primary">Saved locally</span>
            </div>
          </div>
        </div>

        {/* İlerleme Durumu */}
        <div className="mt-6 w-full max-w-2xl">
          <ResolveStatusView
            resolving={resolving}
            progress={progress}
            stage={stage}
            detail={detail}
            onCancel={cancel}
            hasInputUrl={Boolean(inputUrl)}
          />
        </div>

        {/* Son Projeler Şeridi */}
        <div className="mt-12 w-full">
          <RecentProjects limit={6} layout="grid" showHeader hideWhenEmpty={false} />
        </div>

        {/* Alt Güvenlik Notu */}
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
