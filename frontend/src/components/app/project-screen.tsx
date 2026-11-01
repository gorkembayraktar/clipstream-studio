/** Proje çalışma alanı: büyük sahne, altında tam genişlik şerit.
 *
 * LosslessCut düzenine yakın: sahne her zaman en geniş alanı alır, sağ panel
 * varsayılan olarak kapalıdır ve açıldığında sahnenin yanına sütun olarak girer.
 */
import { SidePanel } from "@/components/app/side-panel"
import { TimelineSection } from "@/components/app/timeline-section"
import { VideoStage } from "@/components/app/video-stage"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { cn } from "cn"
import { useProjectUiStore } from "@/stores/project-ui-store"

export function ProjectScreen() {
  useKeyboardShortcuts()
  const panelOpen = useProjectUiStore((s) => s.panelOpen)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sahne ve şerit tek yüzey gibi durur: araya kart/boşluk girmez. */}
      <main
        className={cn(
          "min-h-0 flex-1 gap-2 p-2 max-lg:overflow-y-auto",
          panelOpen
            ? "grid lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]"
            : "grid grid-cols-1",
        )}
      >
        <div className="h-[52vh] min-h-0 lg:h-auto">
          <VideoStage />
        </div>
        {panelOpen && (
          <div className="h-[48vh] min-h-0 lg:h-auto">
            <SidePanel />
          </div>
        )}
      </main>

      <TimelineSection />
    </div>
  )
}
