import { useState, type DragEvent } from "react"
import {
  ClipboardPaste,
  FileVideo2,
  Film,
  Link2,
  Loader2,
  Play,
  Terminal,
  Upload,
} from "lucide-react"

import { RecentProjects } from "@/components/app/recent-projects"
import { SourceCurlDialog } from "@/components/app/source-panels"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/i18n"
import { useSourceResolve, DEMO_URL } from "@/hooks/use-source-resolve"
import { useLocalImportStore } from "@/stores/local-import-store"
import { cn } from "cn"

import { ResolveStatusView, StudioSecurityPill, SUPPORTED_PLATFORMS } from "./shared"

export function VariantDropzone() {
  const { t } = useI18n()
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
  const [isDragging, setIsDragging] = useState(false)
  const [focused, setFocused] = useState(false)

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0]
      void importFile(file)
    }
  }

  return (
    <div
      data-slot="variant-dropzone"
      className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-8 sm:px-8 sm:py-10"
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center">
        {/* Başlık */}
        <div className="text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-secondary/80 px-3 py-1 text-xs font-medium text-secondary-foreground">
            <Film className="size-3.5" />
            <span>Visual Media Ingest</span>
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-4xl">
            Drop in, trim down, export out
          </h1>
          <p className="mt-2 text-xs text-muted-foreground sm:text-sm">
            Drag any local video onto the canvas, or paste a link from YouTube, Twitch, TikTok, or Kick.
          </p>
        </div>

        {/* Büyük Tuval / Drop Alanı */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "relative mt-8 flex w-full flex-col items-center justify-center rounded-3xl border-2 border-dashed p-8 transition-all duration-300 sm:p-12",
            isDragging
              ? "border-primary bg-primary/10 scale-[1.01] shadow-xl shadow-primary/10"
              : "border-border/80 bg-card/60 hover:border-primary/40 hover:bg-card/90 shadow-sm",
          )}
        >
          {/* İkon & Açıklama */}
          <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner">
            <Upload className={cn("size-8 transition-transform duration-300", isDragging && "animate-bounce")} />
          </div>

          <span className="mt-4 text-base font-semibold text-foreground sm:text-lg">
            Drag & drop a video file here
          </span>
          <span className="text-xs text-muted-foreground">
            Supports MP4, MKV, MOV, WebM, AVI, TS
          </span>

          {/* Entegre URL Çubuğu */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void load()
            }}
            className="mt-6 w-full max-w-xl"
          >
            <div
              className={cn(
                "flex items-center gap-2 rounded-2xl border bg-background px-3 py-1.5 shadow-sm transition-all",
                focused
                  ? "border-primary ring-2 ring-primary/20"
                  : "border-border/80 hover:border-border",
              )}
            >
              <Link2 className="size-4 shrink-0 text-muted-foreground" />
              <Input
                ref={inputRef}
                type="search"
                className="h-10 border-0 bg-transparent px-1 text-xs sm:text-sm shadow-none focus-visible:ring-0"
                placeholder="Or paste video link (YouTube, Twitch, TikTok...)"
                spellCheck={false}
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                disabled={resolving}
              />

              <Button
                type="submit"
                size="sm"
                className="h-8 gap-1.5 px-3 text-xs"
                disabled={!inputUrl.trim() || resolving}
              >
                {resolving ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>{t("source.resolving")}</span>
                  </>
                ) : (
                  <>
                    <Play className="size-3.5 fill-current" />
                    <span>{t("source.load")}</span>
                  </>
                )}
              </Button>
            </div>
          </form>

          {/* Hızlı Butonlar */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-full border-border/80 bg-background/80 px-3.5 text-xs"
              onClick={() => void pickFile()}
              disabled={resolving}
            >
              <FileVideo2 className="size-3.5 text-primary" />
              <span>{t("source.pickFile")}</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-full border-border/80 bg-background/80 px-3.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => void paste()}
              disabled={resolving}
            >
              <ClipboardPaste className="size-3.5" />
              <span>{t("source.paste")}</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-full border-border/80 bg-background/80 px-3.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setCurlOpen(true)}
              disabled={resolving}
            >
              <Terminal className="size-3.5 text-amber-500" />
              <span>cURL</span>
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-full px-3 text-xs text-muted-foreground"
              onClick={() => void load(DEMO_URL)}
              disabled={resolving}
            >
              <span>{t("source.demo")}</span>
            </Button>
          </div>

          {/* Platform Şeridi */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {SUPPORTED_PLATFORMS.slice(0, 5).map((plat) => (
              <span
                key={plat}
                className="rounded-full border border-border/40 bg-muted/30 px-2.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {plat}
              </span>
            ))}
          </div>
        </div>

        {/* İlerleme Paneli */}
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
          <RecentProjects limit={8} layout="grid" showHeader hideWhenEmpty={false} />
        </div>

        {/* Güvenlik Notu */}
        <div className="mt-10 mb-4">
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
