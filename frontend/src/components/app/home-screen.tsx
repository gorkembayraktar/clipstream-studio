/** Ana sayfa: yeni proje (kaynak girişi) ve son projeler. */
import { FileVideo2Icon, LinkIcon, RadioIcon, SparklesIcon } from "lucide-react"

import { RecentProjects } from "@/components/app/recent-projects"
import { UrlSourceBar } from "@/components/app/url-source-bar"
import { useI18n } from "@/i18n"
import { useLocalImportStore } from "@/stores/local-import-store"

export function HomeScreen() {
  const { t } = useI18n()
  const pickFile = useLocalImportStore((s) => s.pickFile)

  return (
    <div data-slot="home-screen" className="min-h-0 flex-1 overflow-y-auto">
      <div className="relative mx-auto w-full max-w-[1180px] px-4 py-8 lg:py-12">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-primary/6 via-primary/3 to-transparent"
          aria-hidden
        />

        <header className="relative mb-7 space-y-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary ring-1 ring-primary/15">
            <SparklesIcon className="size-3" />
            ClipStream Studio
          </span>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("home.title")}
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {t("home.subtitle")}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {[
              { icon: LinkIcon, label: t("home.chipUrl") },
              { icon: FileVideo2Icon, label: t("home.chipFile") },
              { icon: RadioIcon, label: t("home.chipLive") },
            ].map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card/60 px-2 py-1 text-[10px] font-medium text-muted-foreground"
              >
                <Icon className="size-3" aria-hidden />
                {label}
              </span>
            ))}
          </div>
        </header>

        <div className="relative grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <section
            data-slot="home-source"
            className="space-y-3 rounded-xl bg-card p-4 shadow-xs ring-1 ring-foreground/10"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t("home.sourceTitle")}</h2>
              <span className="text-[11px] text-muted-foreground">
                {t("home.sourceBadge")}
              </span>
            </div>
            <UrlSourceBar />
            <button
              type="button"
              onClick={() => void pickFile()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/3 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <FileVideo2Icon className="size-3.5" />
              {t("home.dropHint")}
            </button>
          </section>

          <section
            data-slot="home-recent"
            className="space-y-3 rounded-xl bg-card p-4 shadow-xs ring-1 ring-foreground/10"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t("project.historyTitle")}</h2>
              <span className="text-[11px] text-muted-foreground">
                {t("home.recentBadge")}
              </span>
            </div>
            <RecentProjects />
          </section>
        </div>
      </div>
    </div>
  )
}
