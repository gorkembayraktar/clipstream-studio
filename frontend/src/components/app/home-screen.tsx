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
      <div className="relative isolate mx-auto w-full max-w-4xl px-5 pb-12 sm:px-8">
        <div
          aria-hidden
          className="pointer-events-none absolute top-[8%] left-1/2 -z-10 h-72 w-[42rem] max-w-full -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]"
        />

        <section className="flex min-h-[62vh] flex-col items-center justify-center pt-10 pb-8 sm:min-h-[66vh]">
          <h1 className="sr-only">{t("project.newProject")}</h1>

          <div className="w-full max-w-3xl">
            <UrlSourceBar variant="hero" />
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
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

        <section className="mx-auto w-full max-w-3xl">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-tight">
              {t("project.historyTitle")}
            </h2>
            <span className="text-[10px] text-muted-foreground">
              {t("home.recentBadge")}
            </span>
          </div>
          <RecentProjects limit={6} layout="row" />
        </section>

        <p className="mx-auto mt-10 flex max-w-3xl items-center justify-center gap-1.5 text-center text-[10px] text-muted-foreground/70">
          <ShieldCheckIcon className="size-3 shrink-0" aria-hidden />
          {t("home.localNote")}
        </p>
      </div>
    </div>
  )
}
