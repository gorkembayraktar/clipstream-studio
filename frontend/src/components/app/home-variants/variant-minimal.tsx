import { useState } from "react"
import {
  ClipboardPaste,
  FileVideo2,
  Link2,
  Loader2,
  PlayCircle,
  Terminal,
} from "lucide-react"

import { RecentProjects } from "@/components/app/recent-projects"
import { SourceCurlDialog } from "@/components/app/source-panels"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/i18n"
import {
  useSourceResolve,
  DEMO_URL,
  TYPEWRITER_PHRASES,
} from "@/hooks/use-source-resolve"
import { useLocalImportStore } from "@/stores/local-import-store"
import { cn } from "cn"

import {
  ResolveStatusView,
  StudioSecurityPill,
  SUPPORTED_PLATFORMS,
} from "./shared"

export function VariantMinimal() {
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
      data-slot="variant-minimal"
      className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-8 sm:px-8 sm:py-12"
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center">
        {/* Başlık ve Rozet */}
        <div className="flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
            <span className="size-2 rounded-full bg-primary animate-pulse" />
            <span>ClipStream Studio</span>
          </div>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">
            {t("home.hero.title")}{" "}
            <span className="bg-gradient-to-r from-primary via-chart-2 to-primary bg-clip-text text-transparent">
              {t("home.hero.titleAccent")}
            </span>
          </h1>

          <p className="mt-3 max-w-lg text-sm text-muted-foreground sm:text-base">
            {t("home.hero.subtitle")}
          </p>
        </div>

        {/* Ana Arama / URL Çubuğu */}
        <form
          className="mt-8 w-full max-w-2xl"
          onSubmit={(e) => {
            e.preventDefault()
            void load()
          }}
        >
          <div
            className={cn(
              "relative flex items-center gap-2 rounded-2xl border bg-card p-1.5 shadow-sm transition-all duration-200",
              focused
                ? "border-primary ring-2 ring-primary/20 shadow-md"
                : "border-border/80 hover:border-border",
            )}
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground">
              <Link2 className="size-5" />
            </div>

            <Input
              ref={inputRef}
              type="search"
              className="h-11 border-0 bg-transparent px-1 text-sm sm:text-base shadow-none focus-visible:ring-0"
              placeholder={TYPEWRITER_PHRASES[0] + " or video URL..."}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              disabled={resolving}
            />

            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="hidden h-9 px-2.5 text-xs text-muted-foreground sm:inline-flex"
                onClick={() => void paste()}
                disabled={resolving}
                title={t("source.paste")}
              >
                <ClipboardPaste className="size-3.5" />
                <span>{t("source.paste")}</span>
              </Button>

              <Button
                type="submit"
                size="sm"
                className="h-9 px-4 text-xs font-medium"
                disabled={!inputUrl.trim() || resolving}
              >
                {resolving ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>{t("source.resolving")}</span>
                  </>
                ) : (
                  <>
                    <PlayCircle className="size-3.5" />
                    <span>{t("source.load")}</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>

        {/* Hızlı Eylemler */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-full border-border/70 bg-card/60 px-3 text-xs text-foreground hover:bg-accent"
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
            className="h-8 rounded-full border-border/70 bg-card/60 px-3 text-xs text-foreground hover:bg-accent"
            onClick={() => setCurlOpen(true)}
            disabled={resolving}
          >
            <Terminal className="size-3.5 text-amber-500" />
            <span>{t("source.curl")}</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-full border-border/70 bg-card/60 px-3 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => void load(DEMO_URL)}
            disabled={resolving}
          >
            <span>{t("source.demo")}</span>
          </Button>
        </div>

        {/* Desteklenen Platform Etiketleri */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-muted-foreground/70">
          {SUPPORTED_PLATFORMS.slice(0, 6).map((plat) => (
            <span
              key={plat}
              className="rounded-md bg-muted/40 px-2 py-0.5 font-medium"
            >
              {plat}
            </span>
          ))}
        </div>

        {/* İlerleme ve Yükleme Kartları */}
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

        {/* Son Projeler */}
        <div className="mt-12 w-full">
          <RecentProjects limit={8} layout="grid" showHeader hideWhenEmpty={false} />
        </div>

        {/* Güvenlik Notu */}
        <div className="mt-12 mb-6">
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
