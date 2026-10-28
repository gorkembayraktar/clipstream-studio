import { useEffect, useState } from "react"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { toast } from "sonner"

import { AppHeader } from "@/components/app/app-header"
import { FileDropZone } from "@/components/app/file-drop-zone"
import { HomeScreen } from "@/components/app/home-screen"
import { IncomingProjectScreen } from "@/components/app/incoming-project-screen"
import { JobsDock } from "@/components/app/jobs-dock"
import { LogDrawer } from "@/components/app/log-drawer"
import { ProjectLoadingScreen } from "@/components/app/project-loading-screen"
import { ProjectRecoveryScreen } from "@/components/app/project-recovery-screen"
import { ProjectScreen } from "@/components/app/project-screen"
import { ProjectWorkspaceProvider } from "@/components/app/project-workspace-context"
import { SettingsDialog } from "@/components/app/settings-dialog"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  useProjectWorkspace,
  type ProjectWorkspaceController,
} from "@/hooks/use-project-workspace"
import { useIncomingProject } from "@/hooks/use-incoming-project"
import { useProjectRoute } from "@/hooks/use-project-route"
import { useI18n } from "@/i18n"

const TOASTER = {
  richColors: true,
  position: "top-right",
  offset: 56,
  closeButton: true,
  duration: 4200,
} as const

export default function App() {
  const incoming = useIncomingProject()
  useProjectRoute()

  if (incoming.active) {
    return (
      <>
        <IncomingProjectScreen fileName={incoming.fileName} error={incoming.error} />
        <Toaster {...TOASTER} />
      </>
    )
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

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <Workspace />
        <Toaster {...TOASTER} />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

function Workspace() {
  const project = useProjectWorkspace()
  const { t } = useI18n()
  const { notice, dismissNotice } = project

  // Proje uyarıları yer kaplayan şeritler yerine kısa bildirim olarak gösterilir.
  useEffect(() => {
    if (!notice) return
    const missing = notice === "missing"
    // Toaster aboneliği oturduktan sonra göster; aynı turda temizlik bildirimi yutabiliyor.
    window.setTimeout(() => {
      toast.warning(
        missing ? t("project.notFoundTitle") : t("project.storageTitle"),
        {
          description: missing
            ? t("project.notFoundDescription")
            : t("project.storageDescription"),
        },
      )
    }, 50)
    dismissNotice()
  }, [notice, dismissNotice, t])

  return (
    <ProjectWorkspaceProvider value={project}>
      <div className="flex min-h-dvh flex-col bg-background pb-8 lg:h-dvh lg:overflow-hidden">
        <AppHeader />
        {project.projectId ? (
          <ProjectGate project={project} />
        ) : (
          <HomeScreen />
        )}
      </div>
      <SettingsDialog />
      <FileDropZone />
      <LogDrawer />
      {/* Dışa aktarma işleri globaldir: ana sayfada da görünür. */}
      <JobsDock />
    </ProjectWorkspaceProvider>
  )
}

function ProjectGate({ project }: { project: ProjectWorkspaceController }) {
  if (project.phase === "hydrating" || project.phase === "restoring") {
    return (
      <div className="flex min-h-0 flex-1">
        <ProjectLoadingScreen
          phase={project.phase}
          title={project.title}
          progress={project.progress}
          stage={project.stage}
          detail={project.detail}
        />
      </div>
    )
  }

  if (project.phase === "error") {
    return (
      <div className="flex min-h-0 flex-1">
        <ProjectRecoveryScreen
          title={project.title}
          error={project.error}
          onRetry={project.retry}
          onStartFresh={project.startFresh}
        />
      </div>
    )
  }

  return <ProjectScreen />
}
