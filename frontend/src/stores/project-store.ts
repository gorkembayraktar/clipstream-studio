/** Açık projenin kimliği.
 *
 * Proje kimliği `useProjectWorkspace` içinde üretilir; kayıtlar projeye özel
 * olduğu için recorder store'un kimliğe erişmesi gerekir. Store'a yazmak
 * hook durumunu store'lara bağlamadan paylaşmayı sağlar.
 *
 * Akış kimliği = proje kimliği: bir projenin tek akışı vardır.
 */
import { create } from "zustand"

interface ProjectState {
  projectId: string | null
  setProjectId: (id: string | null) => void
}

export const useProjectStore = create<ProjectState>()((set) => ({
  projectId: null,
  setProjectId: (projectId) => set({ projectId }),
}))
