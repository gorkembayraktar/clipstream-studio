import { useState } from "react"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { FileDropZone } from "@/components/app/file-drop-zone"
import { IncomingProjectScreen } from "@/components/app/incoming-project-screen"
import { JobsDock } from "@/components/app/jobs-dock"
import { LogDrawer } from "@/components/app/log-drawer"
import { ProjectBanner } from "@/components/app/project-banner"
import { ProjectLoadingScreen } from "@/components/app/project-loading-screen"
import { ProjectRecoveryScreen } from "@/components/app/project-recovery-screen"
import { ProjectWorkspaceProvider } from "@/components/app/project-workspace-context"
import { SidePanel } from "@/components/app/side-panel"
import { VideoStage } from "@/components/app/video-stage"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  useProjectWorkspace,
  type ProjectWorkspaceController,
} from "@/hooks/use-project-workspace"
import { useIncomingProject } from "@/hooks/use-incoming-project"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { useProjectRoute } from "@/hooks/use-project-route"
import { useLogStore } from "@/stores/log-store"

export default function App() {
  const incoming = useIncomingProject()
  useProjectRoute()

  if (incoming.active) {
    return (
      <>
        <IncomingProjectScreen fileName={incoming.fileName} error={incoming.error} />
        <Toaster richColors position="bottom-left" />
      </>
    )
  }

  return (
    <>
      <StudioApp />
      <Toaster richColors position="bottom-left" />
    </>
  )
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

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <ProjectGate />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

function ProjectGate() {
  const project = useProjectWorkspace()

  if (project.phase === "hydrating" || project.phase === "restoring") {
    return (
      <ProjectLoadingScreen
        phase={project.phase}
        title={project.title}
        progress={project.progress}
        stage={project.stage}
        detail={project.detail}
      />
    )
  }

  if (project.phase === "error") {
    return (
      <ProjectRecoveryScreen
        title={project.title}
        error={project.error}
        onRetry={project.retry}
        onStartFresh={project.startFresh}
      />
    )
  }

  return (
    <ProjectWorkspaceProvider value={project}>
      <StudioContent project={project} />
    </ProjectWorkspaceProvider>
  )
}

function StudioContent({ project }: { project: ProjectWorkspaceController }) {
  useKeyboardShortcuts()
  const showLogs = useLogStore((s) => s.showLogs)

  return (
    <>
      <div className="min-h-screen pb-14">
        {project.notice && (
          <div className="mx-auto max-w-[1500px] px-4 pt-4">
            <ProjectBanner
              notice={project.notice}
              onDismiss={project.dismissNotice}
            />
          </div>
        )}
        <main className="mx-auto grid max-w-[1500px] items-start gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_390px]">
          <div className="min-w-0">
            <VideoStage />
          </div>
          <div className="min-w-0">
            <SidePanel />
          </div>
        </main>
      </div>

      <JobsDock />
      {showLogs && <LogDrawer />}
      <FileDropZone />
    </>
  )
}
