/** Proje çalışma alanı: sahne + sağ panel, altında tam genişlik zaman çizelgesi. */
import { JobsDock } from "@/components/app/jobs-dock"
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
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <main
          className={cn(
            "min-h-0 flex-1 gap-3 p-3",
            panelOpen
              ? "grid lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]"
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

        <div className="shrink-0 px-3 pb-3">
          <div className="overflow-hidden rounded-xl bg-card shadow-xs ring-1 ring-foreground/10">
            <TimelineSection />
          </div>
        </div>
      </div>

      <JobsDock />
    </>
  )
}
