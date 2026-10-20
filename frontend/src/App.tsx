import { useState } from "react"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { FileDropZone } from "@/components/app/file-drop-zone"
import { IncomingProjectScreen } from "@/components/app/incoming-project-screen"
import { LogDrawer } from "@/components/app/log-drawer"
import { SidePanel } from "@/components/app/side-panel"
import { VideoStage } from "@/components/app/video-stage"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useIncomingProject } from "@/hooks/use-incoming-project"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"

export default function App() {
  const incoming = useIncomingProject()

  if (incoming.active) {
    return <IncomingProjectScreen fileName={incoming.fileName} error={incoming.error} />
  }

  return <StudioApp />
}

function StudioApp() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 0, refetchOnWindowFocus: false },
        },
      }),
  )

  useKeyboardShortcuts()

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <div className="min-h-screen pb-14">
          <main className="mx-auto grid max-w-[1500px] items-start gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_390px]">
            <div className="min-w-0">
              <VideoStage />
            </div>
            <div className="min-w-0">
              <SidePanel />
            </div>
          </main>

          <footer className="mx-auto max-w-[1500px] px-4 pb-6 text-center text-[11px] text-muted-foreground">
            Boşluk: oynat/durdur · ←/→: 1 sn · Shift+←/→: 5 sn · , / . : hassas adım (Shift: ×10) ·
            ↑/↓: ses · M: sessiz · F: tam ekran · P: pencere içinde pencere · T: tema ·
            I / [ : giriş · O / ] : çıkış · L: döngü
          </footer>
        </div>

        <Toaster richColors position="bottom-right" />
        <LogDrawer />
        <FileDropZone />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
