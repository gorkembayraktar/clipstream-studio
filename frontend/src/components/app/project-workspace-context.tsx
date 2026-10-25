/** Proje çalışma alanı denetleyicisini derin bileşenlere taşır. */
import { createContext, useContext, type ReactNode } from "react"

import type { ProjectWorkspaceController } from "@/hooks/use-project-workspace"

const ProjectWorkspaceContext = createContext<ProjectWorkspaceController | null>(
  null,
)

interface ProjectWorkspaceProviderProps {
  value: ProjectWorkspaceController
  children: ReactNode
}

export function ProjectWorkspaceProvider({
  value,
  children,
}: ProjectWorkspaceProviderProps) {
  return (
    <ProjectWorkspaceContext.Provider value={value}>
      {children}
    </ProjectWorkspaceContext.Provider>
  )
}

export function useProjectWorkspaceController(): ProjectWorkspaceController {
  const value = useContext(ProjectWorkspaceContext)
  if (!value) {
    throw new Error("useProjectWorkspaceController must be used inside the provider")
  }
  return value
}
