/** Ana sayfa: tek odaklı yeni proje yüzeyi ve son projeler. */
import { FileVideo2Icon, LinkIcon, ShieldCheckIcon } from "lucide-react"

import { RecentProjects } from "@/components/app/recent-projects"
import { UrlSourceBar } from "@/components/app/url-source-bar"
import { Badge } from "@/components/ui/badge"
import { useI18n } from "@/i18n"
import { useLocalImportStore } from "@/stores/local-import-store"

export function HomeScreen() {
  const { t } = useI18n()
  const pickFile = useLocalImportStore((s) => s.pickFile)

  return (
    <div data-slot="home-screen" className="min-h-0 flex-1 overflow-y-auto">
      <div className="relative isolate mx-auto w-full max-w-[1080px] px-5 pt-10 pb-12 sm:px-8 lg:pt-16">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-28 left-1/2 -z-10 h-64 w-[34rem] max-w-full -translate-x-1/2 rounded-full bg-primary/10 blur-[110px]"
        />

        <header className="mx-auto max-w-2xl text-center">
          <Badge
            variant="outline"
            className="h-6 gap-1.5 rounded-full border-primary/20 bg-primary/5 px-2.5 text-[10px] font-semibold tracking-wide text-primary"
          >
            <span className="size-1.5 rounded-full bg-primary" aria-hidden />
            {t("home.eyebrow")}
          </Badge>
          <h1 className="mt-4 text-balance text-[1.7rem] leading-tight font-semibold tracking-tight sm:text-4xl">
            {t("home.title")}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-muted-foreground">
            {t("home.subtitle")}
          </p>
        </header>

        <section className="mx-auto mt-8 w-full max-w-3xl">
          <div className="rounded-2xl border border-border/70 bg-card/70 p-2 shadow-xl shadow-black/5 ring-1 ring-foreground/5 backdrop-blur-md">
            <div className="flex items-center gap-1.5 px-2 pt-1 pb-2 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
              <LinkIcon className="size-3" aria-hidden />
              {t("home.commandLabel")}
              <kbd className="ml-auto rounded border border-border/70 bg-muted/50 px-1.5 py-0.5 font-mono text-[9px] tracking-normal normal-case">
                Enter
              </kbd>
            </div>
            <div className="rounded-xl border border-border/50 bg-background/60 p-2">
              <UrlSourceBar />
            </div>
          </div>

          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={() => void pickFile()}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/40 px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <FileVideo2Icon className="size-3.5" aria-hidden />
              {t("source.pickFile")}
            </button>
          </div>
        </section>

        <section className="mx-auto mt-12 w-full max-w-3xl">
          <div className="mb-3 space-y-0.5">
            <h2 className="text-sm font-semibold tracking-tight">
              {t("project.historyTitle")}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {t("home.recentBadge")}
            </p>
          </div>
          <RecentProjects limit={6} />
        </section>

        <p className="mx-auto mt-10 flex max-w-xl items-center justify-center gap-1.5 text-center text-[10px] text-muted-foreground/70">
          <ShieldCheckIcon className="size-3 shrink-0" aria-hidden />
          {t("home.localNote")}
        </p>
      </div>
    </div>
  )
}
