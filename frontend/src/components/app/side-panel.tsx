/** Sağ panel: Kaynak / Dışa Aktar / Galeri sekmeleri. */
import { useEffect, useRef } from "react"

import { FilmIcon, Link2Icon, ScissorsIcon, SettingsIcon } from "lucide-react"

import { ExportPanel } from "@/components/app/export-panel"
import { Gallery } from "@/components/app/gallery"
import { SettingsPanel } from "@/components/app/settings-panel"
import { UrlSourceBar } from "@/components/app/url-source-bar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useLibrary } from "@/hooks/use-library"
import { useI18n } from "@/i18n"
import { useProjectUiStore, type PanelTab } from "@/stores/project-ui-store"
import { useSourceStore } from "@/stores/source-store"

export function SidePanel() {
  const { t } = useI18n()
  const streamUrl = useSourceStore((s) => s.streamUrl)
  const tab = useProjectUiStore((s) => s.panelTab)
  const setTab = useProjectUiStore((s) => s.setPanelTab)
  const hadSourceRef = useRef(Boolean(streamUrl))

  const { data } = useLibrary()
  const clipCount = data?.files.length ?? 0

  // Kaynak temizlenince kaynak sekmesine dönülür. İlk açılışta projeden gelen
  // sekme korunur; kaynak yüklendiğinde sekme kendiliğinden değişmez.
  useEffect(() => {
    if (hadSourceRef.current && !streamUrl) setTab("source")
    hadSourceRef.current = Boolean(streamUrl)
  }, [streamUrl, setTab])

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as PanelTab)}
      className="gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10"
    >
      <TabsList className="w-full">
        <TabsTrigger value="source">
          <Link2Icon />
          {t("tabs.source")}
        </TabsTrigger>
        <TabsTrigger value="export">
          <ScissorsIcon />
          {t("tabs.export")}
        </TabsTrigger>
        <TabsTrigger value="gallery">
          <FilmIcon />
          {t("tabs.gallery")}
          {clipCount > 0 && (
            <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
              {clipCount}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="settings">
          <SettingsIcon />
          {t("tabs.settings")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="source">
        <UrlSourceBar />
      </TabsContent>
      <TabsContent value="export">
        <ExportPanel />
      </TabsContent>
      <TabsContent value="gallery">
        <Gallery />
      </TabsContent>
      <TabsContent value="settings">
        <SettingsPanel />
      </TabsContent>
    </Tabs>
  )
}
