import { useState } from "react"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { FileDropZone } from "@/components/app/file-drop-zone"
import { IncomingProjectScreen } from "@/components/app/incoming-project-screen"
import { JobsDock } from "@/components/app/jobs-dock"
import { LogDrawer } from "@/components/app/log-drawer"
import { PreferencesSwitcher } from "@/components/app/preferences-switcher"
import { SidePanel } from "@/components/app/side-panel"
import { VideoStage } from "@/components/app/video-stage"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useIncomingProject } from "@/hooks/use-incoming-project"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { useI18n } from "@/i18n"

export default function App() {
  const incoming = useIncomingProject()

  if (incoming.active) {
    return <IncomingProjectScreen fileName={incoming.fileName} error={incoming.error} />
  }

  return <StudioApp />
}

function StudioApp() {
  const { t } = useI18n()
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

          <footer className="mx-auto flex max-w-[1500px] flex-col items-center gap-2 px-4 pb-6 text-center text-[11px] text-muted-foreground sm:flex-row sm:justify-between sm:text-left">
            <p>{t("app.shortcuts")}</p>
            <PreferencesSwitcher />
          </footer>
        </div>

        <JobsDock />
        <Toaster richColors position="bottom-left" />
        <LogDrawer />
        <FileDropZone />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
