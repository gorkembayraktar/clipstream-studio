import { useState } from "react"
import {
  ArrowUpRight,
  ClipboardPaste,
  FileVideo,
  Loader2,
  Sparkles,
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

export function VariantZen() {
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

  const recentProjects = listProjectWorkspaces().slice(0, 5)

  return (
    <div
      data-slot="variant-zen"
      className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-12"
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center">
        {/* Zen Başlık */}
        <div className="text-center">
          <span className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
            Pure Creative Flow
          </span>
          <h1 className="mt-3 text-3xl font-light tracking-tight text-foreground sm:text-5xl">
            What are we clipping today?
          </h1>
          <p className="mt-2 text-xs text-muted-foreground/80 sm:text-sm">
            Paste any stream link or drop a video file onto the canvas.
          </p>
        </div>

        {/* Minimalist Çizgisiz Giriş Alanı */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void load()
          }}
          className="mt-10 w-full"
        >
          <div className="relative">
            <Input
              ref={inputRef}
              type="search"
              className={cn(
                "h-14 w-full border-0 border-b bg-transparent px-2 text-base sm:text-xl font-light shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/40 rounded-none transition-colors",
                focused ? "border-primary" : "border-border/80",
              )}
              placeholder="Paste video URL here..."
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              disabled={resolving}
            />

            {/* Sağ Uçtaki Yükleme Düğmesi */}
            <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => void paste()}
                disabled={resolving}
              >
                <ClipboardPaste className="size-4 mr-1" />
                Paste
              </Button>

              <Button
                type="submit"
                size="sm"
                className="h-9 rounded-full px-5 text-xs font-medium"
                disabled={!inputUrl.trim() || resolving}
              >
                {resolving ? (
                  <Loader2 className="size-3.5 animate-spin mr-1" />
                ) : (
                  <Sparkles className="size-3.5 mr-1" />
                )}
                <span>Begin</span>
              </Button>
            </div>
          </div>
        </form>

        {/* Hızlı Eylemler (Hafif Metin Bağlantıları) */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => void pickFile()}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
            disabled={resolving}
          >
            <FileVideo className="size-3.5 text-primary" />
            <span>Choose local file</span>
          </button>

          <span>·</span>

          <button
            type="button"
            onClick={() => void load(DEMO_URL)}
            className="hover:text-foreground transition-colors"
            disabled={resolving}
          >
            Try sample video
          </button>

          <span>·</span>

          <button
            type="button"
            onClick={() => setCurlOpen(true)}
            className="hover:text-foreground transition-colors"
            disabled={resolving}
          >
            cURL headers
          </button>
        </div>

        {/* İlerleme Paneli */}
        <div className="mt-6 w-full">
          <ResolveStatusView
            resolving={resolving}
            progress={progress}
            stage={stage}
            detail={detail}
            onCancel={cancel}
            hasInputUrl={Boolean(inputUrl)}
          />
        </div>

        {/* Sakin Son Projeler Listesi */}
        {recentProjects.length > 0 && (
          <div className="mt-16 w-full border-t border-border/40 pt-6">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 block mb-3">
              Recent Workspaces
            </span>

            <div className="divide-y divide-border/40">
              {recentProjects.map((proj) => (
                <div
                  key={proj.id}
                  onClick={() => window.location.assign(projectUrl(proj.id))}
                  role="button"
                  tabIndex={0}
                  className="group flex items-center justify-between py-3 text-xs transition-colors hover:text-primary cursor-pointer"
                >
                  <div className="flex items-center gap-3 truncate">
                    <span className="font-medium text-foreground group-hover:text-primary transition-colors truncate">
                      {proj.title || proj.source?.title || "Untitled Project"}
                    </span>
                    <span className="text-[10px] text-muted-foreground/70 uppercase">
                      {proj.source?.platform || "media"}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 text-muted-foreground group-hover:text-primary">
                    <span className="text-[11px]">
                      {new Date(proj.updated_date).toLocaleDateString()}
                    </span>
                    <ArrowUpRight className="size-3.5" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-12 text-center">
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
