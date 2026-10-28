/** Tasarım A — "Spotlight": sinematik, tek odaklı giriş.
 *
 * Büyük tipografi, akan ışık lekeleri ve yumuşak yükselme animasyonları.
 */
import { useState } from "react"

import {
  ClipboardPaste,
  FileVideo2Icon,
  Link2,
  Loader2,
  ShieldCheckIcon,
  Terminal,
} from "lucide-react"

import { RecentProjects } from "@/components/app/recent-projects"
import {
  ImportProgressCard,
  ResolveProgressCard,
  SourceCurlDialog,
  SourceSummaryCard,
} from "@/components/app/source-panels"
import { TypewriterPlaceholder } from "@/components/app/typewriter-placeholder"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/i18n"
import { useSourceResolve, DEMO_URL, TYPEWRITER_PHRASES } from "@/hooks/use-source-resolve"
import { useLocalImportStore } from "@/stores/local-import-store"
import { cn } from "cn"

const PLATFORMS = ["YouTube", "X", "Instagram", "TikTok", "Twitch", "Vimeo", "Facebook"]

export function HomeSpotlight() {
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
  const [focused, setFocused] = useState(false)
  const [curlOpen, setCurlOpen] = useState(false)

  return (
    <div data-slot="home-spotlight" className="relative min-h-0 flex-1 overflow-y-auto">
      {/* Arka plan: yavaşça sürüklenen ışık lekeleri ve ince ızgara dokusu. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="home-orb home-orb-a" />
        <div className="home-orb home-orb-b" />
        <div className="home-orb home-orb-c" />
        <div className="home-noise absolute inset-0 opacity-[0.35]" />
      </div>

      <div className="relative mx-auto w-full max-w-4xl px-5 pb-20 sm:px-8">
        <section className="flex min-h-[74vh] flex-col items-center justify-center pt-14 pb-10">
          <span
            className="home-rise inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/50 px-3 py-1 text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase backdrop-blur"
            style={{ animationDelay: "0ms" }}
          >
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/70" />
              <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
            </span>
            {t("home.hero.eyebrow")}
          </span>

          <h1 className="mt-7 text-center">
            <span
              className="home-rise block text-4xl font-semibold tracking-tight text-balance sm:text-6xl"
              style={{ animationDelay: "80ms" }}
            >
              {t("home.hero.title")}
            </span>
            <span
              className="home-rise mt-1 block"
              style={{ animationDelay: "160ms" }}
            >
              <span className="home-gradient-pan block bg-gradient-to-r from-primary via-chart-2 to-primary bg-[length:220%_100%] bg-clip-text text-4xl font-semibold tracking-tight text-transparent text-balance sm:text-6xl">
                {t("home.hero.titleAccent")}
              </span>
            </span>
          </h1>

          <p
            className="home-rise mt-5 max-w-md text-center text-sm leading-relaxed text-muted-foreground"
            style={{ animationDelay: "240ms" }}
          >
            {t("home.hero.subtitle")}
          </p>

          <form
            className="home-rise mt-10 w-full max-w-3xl"
            style={{ animationDelay: "320ms" }}
            onSubmit={(event) => {
              event.preventDefault()
              void load()
            }}
          >
            <div
              className={cn(
                "group relative rounded-full p-px transition-all duration-500",
                "bg-gradient-to-r from-border/70 via-border/30 to-border/70",
                "hover:from-primary/50 hover:via-chart-2/40 hover:to-primary/50",
                focused &&
                  "from-primary/70 via-chart-2/60 to-primary/70 shadow-[0_0_50px_-12px_var(--primary)]",
              )}
            >
              <div className="flex items-center gap-3 rounded-full border border-transparent bg-card/85 px-4 py-2 backdrop-blur-xl sm:px-5">
                <Link2
                  className={cn(
                    "size-5 shrink-0 transition-colors duration-300",
                    focused ? "text-primary" : "text-muted-foreground/60",
                  )}
                  aria-hidden
                />
                <div className="relative min-w-0 flex-1">
                  <Input
                    ref={inputRef}
                    type="search"
                    className="h-11 border-0 bg-transparent px-0 text-base font-medium shadow-none focus-visible:border-0 focus-visible:ring-0 sm:h-12 sm:text-lg dark:bg-transparent"
                    placeholder=""
                    aria-label={t("source.urlAria")}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    value={inputUrl}
                    onChange={(event) => setInputUrl(event.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    disabled={resolving}
                  />
                  {!inputUrl && !focused && !resolving && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 left-0 flex items-center overflow-hidden"
                    >
                      <TypewriterPlaceholder
                        phrases={TYPEWRITER_PHRASES}
                        className="max-w-full text-base font-medium text-muted-foreground/60 sm:text-lg"
                      />
                    </div>
                  )}
                </div>
                <Button
                  type="submit"
                  className="h-10 shrink-0 gap-1.5 rounded-full px-4 text-xs transition-transform duration-300 hover:scale-[1.03] active:scale-95"
                  disabled={!inputUrl.trim() || resolving}
                >
                  {resolving ? <Loader2 className="animate-spin" /> : <Link2 />}
                  <span className="hidden sm:inline">
                    {resolving ? t("source.resolving") : t("source.load")}
                  </span>
                </Button>
              </div>
            </div>
          </form>

          <div
            className="home-rise mt-4 flex flex-wrap items-center justify-center gap-1.5"
            style={{ animationDelay: "400ms" }}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-full px-3 text-muted-foreground hover:bg-card/70"
              onClick={() => void paste()}
              disabled={resolving}
            >
              <ClipboardPaste />
              {t("source.paste")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-full px-3 text-muted-foreground hover:bg-card/70"
              onClick={() => void pickFile()}
              disabled={resolving}
            >
              <FileVideo2Icon />
              {t("source.pickFile")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-full px-3 text-muted-foreground hover:bg-card/70"
              onClick={() => setCurlOpen(true)}
              disabled={resolving}
            >
              <Terminal />
              {t("source.curl")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-full px-3 text-muted-foreground/70 hover:bg-card/70"
              onClick={() => void load(DEMO_URL)}
              disabled={resolving}
            >
              {t("source.demo")}
            </Button>
          </div>

          {(resolving || inputUrl) && (
            <div className="mt-5 w-full max-w-2xl space-y-2">
              {resolving && (
                <ResolveProgressCard
                  progress={progress}
                  stage={stage}
                  detail={detail}
                  onCancel={cancel}
                />
              )}
              <ImportProgressCard />
              <SourceSummaryCard />
            </div>
          )}

          <div
            className="home-marquee mt-14 w-full overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]"
            aria-hidden
          >
            <div className="home-marquee-track flex w-max items-center gap-7 text-[10px] font-medium tracking-[0.28em] text-muted-foreground/45 uppercase">
              {[...PLATFORMS, ...PLATFORMS].map((name, index) => (
                <span key={`${name}-${index}`} className="flex items-center gap-7">
                  {name}
                  <span className="size-1 rounded-full bg-primary/35" />
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-3xl">
          <RecentProjects limit={6} layout="grid" showHeader hideWhenEmpty />
        </section>

        <p className="mx-auto mt-10 flex max-w-3xl items-center justify-center gap-1.5 text-center text-[10px] text-muted-foreground/70">
          <ShieldCheckIcon className="size-3 shrink-0" aria-hidden />
          {t("home.localNote")}
        </p>
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
