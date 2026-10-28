/** Ana sayfa: tek odaklı yeni proje yüzeyi ve son projeler. */
import { FileVideo2Icon, ShieldCheckIcon } from "lucide-react"

import { RecentProjects } from "@/components/app/recent-projects"
import { UrlSourceBar } from "@/components/app/url-source-bar"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/i18n"
import { useLocalImportStore } from "@/stores/local-import-store"

export function HomeScreen() {
  const { t } = useI18n()
  const pickFile = useLocalImportStore((s) => s.pickFile)

  return (
    <div data-slot="home-screen" className="min-h-0 flex-1 overflow-y-auto">
      <div className="relative isolate mx-auto w-full max-w-[1120px] px-5 pt-8 pb-12 sm:px-8 lg:pt-12">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-64 w-[36rem] max-w-full -translate-x-1/2 rounded-full bg-primary/10 blur-[110px]"
        />

        <div className="mx-auto grid w-full max-w-5xl gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-10">
          <section className="min-w-0">
            <div className="flex items-center gap-3">
              <img
                src="/clipstream-logo-light.svg"
                alt={t("app.name")}
                className="h-8 w-auto dark:hidden"
              />
              <img
                src="/clipstream-logo-dark.svg"
                alt={t("app.name")}
                className="hidden h-8 w-auto dark:block"
              />
              <div className="min-w-0">
                <h1 className="text-lg font-semibold tracking-tight">
                  {t("project.newProject")}
                </h1>
                <p className="truncate text-[11px] text-muted-foreground">
                  {t("home.sourceBadge")}
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-border/70 bg-card/70 p-2 shadow-xl shadow-black/5 ring-1 ring-primary/10 backdrop-blur-md sm:p-3">
              <UrlSourceBar />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="rounded-full"
                onClick={() => void pickFile()}
              >
                <FileVideo2Icon />
                {t("source.pickFile")}
              </Button>
            </div>
          </section>

          <aside className="min-w-0">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold tracking-tight">
                {t("project.historyTitle")}
              </h2>
              <span className="text-[10px] text-muted-foreground">
                {t("home.recentBadge")}
              </span>
            </div>
            <RecentProjects limit={5} layout="list" />
          </aside>
        </div>

        <p className="mx-auto mt-10 flex max-w-5xl items-center justify-center gap-1.5 text-center text-[10px] text-muted-foreground/70">
          <ShieldCheckIcon className="size-3 shrink-0" aria-hidden />
          {t("home.localNote")}
        </p>
      </div>
    </div>
  )
}
