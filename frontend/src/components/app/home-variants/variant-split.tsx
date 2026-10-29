import { useState } from "react"
import {
  ClipboardPaste,
  FileVideo2,
  HardDrive,
  Link2,
  Loader2,
  Play,
  ShieldCheck,
  Terminal,
  Zap,
} from "lucide-react"

import { RecentProjects } from "@/components/app/recent-projects"
import { SourceCurlDialog } from "@/components/app/source-panels"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/i18n"
import { useSourceResolve, DEMO_URL } from "@/hooks/use-source-resolve"
import { useLocalImportStore } from "@/stores/local-import-store"
import { cn } from "cn"

import { ResolveStatusView, SUPPORTED_PLATFORMS } from "./shared"

export function VariantSplit() {
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

  return (
    <div
      data-slot="variant-split"
      className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-8 sm:py-8"
    >
      <div className="mx-auto w-full max-w-6xl">
        {/* Üst Kısa Başlık */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              ClipStream Dashboard
            </h1>
            <p className="text-xs text-muted-foreground">
              Local, hardware-accelerated video clipper & stream recorder
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <ShieldCheck className="size-3.5 text-emerald-500" />
              100% Local
            </span>
            <span className="size-1 rounded-full bg-border" />
            <span className="flex items-center gap-1">
              <Zap className="size-3.5 text-amber-500" />
              GPU Ready
            </span>
          </div>
        </div>

        {/* İki Kolonlu Izgara */}
        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
          {/* Sol Kolon: Yeni Proje & Kaynak Girişi */}
          <div className="space-y-6 lg:col-span-7">
            <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
              <div className="mb-4">
                <h2 className="text-base font-semibold text-foreground">
                  Start New Session
                </h2>
                <p className="text-xs text-muted-foreground">
                  Paste a streaming link or open a local video file to begin trimming.
                </p>
              </div>

              {/* URL Girişi */}
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void load()
                }}
                className="space-y-3"
              >
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-xl border bg-background px-3 py-1.5 transition-all",
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
                    placeholder="Paste YouTube, Twitch, TikTok, Kick or HLS link..."
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
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
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => void paste()}
                    disabled={resolving}
                    title={t("source.paste")}
                  >
                    <ClipboardPaste className="size-4" />
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="submit"
                    className="h-10 flex-1 gap-2 text-xs font-medium"
                    disabled={!inputUrl.trim() || resolving}
                  >
                    {resolving ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        <span>{t("source.resolving")}</span>
                      </>
                    ) : (
                      <>
                        <Play className="size-3.5 fill-current" />
                        <span>Load Stream / URL</span>
                      </>
                    )}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 gap-1.5 text-xs"
                    onClick={() => setCurlOpen(true)}
                    disabled={resolving}
                    title="Custom Headers & cURL"
                  >
                    <Terminal className="size-3.5" />
                    <span>cURL</span>
                  </Button>
                </div>
              </form>

              {/* Ayrıcı */}
              <div className="relative my-6 text-center">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border/50" />
                </div>
                <span className="relative bg-card px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  or upload from device
                </span>
              </div>

              {/* Yerel Dosya Açma Tuşu */}
              <button
                type="button"
                onClick={() => void pickFile()}
                disabled={resolving}
                className="group flex w-full items-center justify-between rounded-xl border border-dashed border-border/80 bg-muted/20 p-4 text-left transition-all hover:border-primary/50 hover:bg-primary/5"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:scale-105 transition-transform">
                    <FileVideo2 className="size-5" />
                  </div>
                  <div>
                    <span className="block text-xs font-semibold text-foreground">
                      Choose Local Video File
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      MP4, MKV, MOV, WebM · Instant lossless remux
                    </span>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="pointer-events-none text-xs"
                >
                  Browse Files
                </Button>
              </button>

              {/* Hızlı Demo Seçeneği */}
              <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                <span>Want to test before loading your own clip?</span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs text-primary"
                  onClick={() => void load(DEMO_URL)}
                  disabled={resolving}
                >
                  Load Sample Demo Clip →
                </Button>
              </div>

              {/* İlerleme Panelleri */}
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
            </div>

            {/* Alt Özellik Rozetleri */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-border/50 bg-card/40 p-3 text-center">
                <HardDrive className="mx-auto mb-1 size-4 text-primary" />
                <span className="block text-xs font-medium">Local Disk</span>
                <span className="block text-[10px] text-muted-foreground">No cloud transfer</span>
              </div>
              <div className="rounded-xl border border-border/50 bg-card/40 p-3 text-center">
                <Zap className="mx-auto mb-1 size-4 text-amber-500" />
                <span className="block text-xs font-medium">Fast Export</span>
                <span className="block text-[10px] text-muted-foreground">NVENC / QSV enabled</span>
              </div>
              <div className="rounded-xl border border-border/50 bg-card/40 p-3 text-center">
                <ShieldCheck className="mx-auto mb-1 size-4 text-emerald-500" />
                <span className="block text-xs font-medium">Private</span>
                <span className="block text-[10px] text-muted-foreground">Runs 100% on localhost</span>
              </div>
            </div>
          </div>

          {/* Sağ Kolon: Son Projeler & Geçmiş */}
          <div className="space-y-4 lg:col-span-5">
            <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    Recent Workspaces
                  </h2>
                  <p className="text-[11px] text-muted-foreground">
                    Continue editing clips from this browser
                  </p>
                </div>
              </div>

              <div className="mt-3">
                <RecentProjects layout="list" limit={8} emptyHint showHeader={false} />
              </div>
            </div>

            {/* Desteklenen Kaynaklar */}
            <div className="rounded-2xl border border-border/50 bg-muted/15 p-4 text-xs">
              <span className="mb-2 block font-medium text-foreground">
                Supported Platforms:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {SUPPORTED_PLATFORMS.map((plat) => (
                  <span
                    key={plat}
                    className="rounded-md border border-border/50 bg-card/80 px-2 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {plat}
                  </span>
                ))}
              </div>
            </div>
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
