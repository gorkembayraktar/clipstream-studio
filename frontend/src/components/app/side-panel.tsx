/** Sağ panel: Dışa Aktar / Galeri sekmeleri. Kapatılabilir (kaynak ve ayarlar üst menüde). */
import { FilmIcon, PanelRightCloseIcon, ScissorsIcon } from "lucide-react"

import { ExportPanel } from "@/components/app/export-panel"
import { Gallery } from "@/components/app/gallery"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useLibrary } from "@/hooks/use-library"
import { useI18n } from "@/i18n"
import { useProjectUiStore, type PanelTab } from "@/stores/project-ui-store"

export function SidePanel() {
  const { t } = useI18n()
  const tab = useProjectUiStore((s) => s.panelTab)
  const setTab = useProjectUiStore((s) => s.setPanelTab)
  const setPanelOpen = useProjectUiStore((s) => s.setPanelOpen)

  const { data } = useLibrary()
  const clipCount = data?.files.length ?? 0

  return (
    <section
      data-slot="side-panel"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10"
    >
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as PanelTab)}
        className="flex h-full min-h-0 flex-col gap-0"
      >
        <div className="flex items-center gap-1 border-b border-border/60 p-1.5">
          <TabsList className="min-w-0 flex-1">
            <TabsTrigger value="export" className="min-w-0">
              <ScissorsIcon />
              <span className="truncate">{t("tabs.export")}</span>
            </TabsTrigger>
            <TabsTrigger value="gallery" className="min-w-0">
              <FilmIcon />
              <span className="truncate">{t("tabs.gallery")}</span>
              {clipCount > 0 && (
                <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                  {clipCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPanelOpen(false)}
            title={t("menu.hidePanel")}
            aria-label={t("menu.hidePanel")}
            className="shrink-0 text-muted-foreground"
          >
            <PanelRightCloseIcon />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <TabsContent value="export" className="mt-0">
            <ExportPanel />
          </TabsContent>
          <TabsContent value="gallery" className="mt-0">
            <Gallery />
          </TabsContent>
        </div>
      </Tabs>
    </section>
  )
}
