/** Oturum başlatma ekranı: kaynak çözümleme ve içe aktarma boyunca süren splash.
 *
 * Ana sayfadaki "oturum başlat" eylemleri bu mağazayı açar; süreç bitince
 * kapanır. Böylece splash, ana sayfadan proje ekranına geçişte de görünür kalır.
 * Her `start` bir jeton döndürür: yalnızca kendi jetonuyla kapatılabilir, böylece
 * eşzamanlı bir içe aktarma çözümleme ekranını yanlışlıkla kapatmaz.
 */
import { create } from "zustand"

interface SessionSplashState {
  open: boolean
  /** 0-100 arası yüzde; `null` belirsiz ilerleme. */
  progress: number | null
  stage: string | null
  detail: string
  cancel: (() => void) | null
  token: number | null
  start: (params?: { cancel?: () => void }) => number
  update: (patch: Partial<Pick<SessionSplashState, "progress" | "stage" | "detail">>) => void
  finish: (token?: number) => void
}

let splashSequence = 0

export const useSessionSplashStore = create<SessionSplashState>()((set) => ({
  open: false,
  progress: null,
  stage: null,
  detail: "",
  cancel: null,
  token: null,

  start: ({ cancel } = {}) => {
    splashSequence += 1
    const token = splashSequence
    set({
      open: true,
      progress: null,
      stage: null,
      detail: "",
      cancel: cancel ?? null,
      token,
    })
    return token
  },

  update: (patch) =>
    set((state) => ({
      progress: patch.progress !== undefined ? patch.progress : state.progress,
      stage: patch.stage !== undefined ? patch.stage : state.stage,
      detail: patch.detail !== undefined ? patch.detail : state.detail,
    })),

  finish: (token) =>
    set((state) =>
      token === undefined || token === state.token
        ? { open: false, cancel: null, token: null }
        : state,
    ),
}))
