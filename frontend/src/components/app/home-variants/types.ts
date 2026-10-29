export type HomeVariantId =
  | "broadcast"
  | "hud"
  | "stage"
  | "dock"
  | "workbench"
  | "nle"
  | "resolve"
  | "launcher"
  | "native-modal"
  | "daw"
  | "island"
  | "cinema"
  | "bento"
  | "terminal"
  | "zen"
  | "minimal"
  | "split"
  | "cards"
  | "dropzone"
  | "toolbelt"
  | "spotlight"

export interface VariantMeta {
  id: HomeVariantId
  number: string
  nameKey: string
  descKey: string
  group: "hardware-studio" | "app-welcome" | "creative" | "dashboard"
}

export const HOME_VARIANTS: VariantMeta[] = [
  // 5 Yeni Donanım & Profesyonel Stüdyo Karşılama Tasarımı (16 - 20)
  {
    id: "broadcast",
    number: "16",
    nameKey: "home.variants.broadcast",
    descKey: "home.variants.broadcastDesc",
    group: "hardware-studio",
  },
  {
    id: "hud",
    number: "17",
    nameKey: "home.variants.hud",
    descKey: "home.variants.hudDesc",
    group: "hardware-studio",
  },
  {
    id: "stage",
    number: "18",
    nameKey: "home.variants.stage",
    descKey: "home.variants.stageDesc",
    group: "hardware-studio",
  },
  {
    id: "dock",
    number: "19",
    nameKey: "home.variants.dock",
    descKey: "home.variants.dockDesc",
    group: "hardware-studio",
  },
  {
    id: "workbench",
    number: "20",
    nameKey: "home.variants.workbench",
    descKey: "home.variants.workbenchDesc",
    group: "hardware-studio",
  },

  // Masaüstü Yazılım Karşılama Ekranları (11 - 15)
  {
    id: "nle",
    number: "11",
    nameKey: "home.variants.nle",
    descKey: "home.variants.nleDesc",
    group: "app-welcome",
  },
  {
    id: "resolve",
    number: "12",
    nameKey: "home.variants.resolve",
    descKey: "home.variants.resolveDesc",
    group: "app-welcome",
  },
  {
    id: "launcher",
    number: "13",
    nameKey: "home.variants.launcher",
    descKey: "home.variants.launcherDesc",
    group: "app-welcome",
  },
  {
    id: "native-modal",
    number: "14",
    nameKey: "home.variants.nativeModal",
    descKey: "home.variants.nativeModalDesc",
    group: "app-welcome",
  },
  {
    id: "daw",
    number: "15",
    nameKey: "home.variants.daw",
    descKey: "home.variants.dawDesc",
    group: "app-welcome",
  },

  // Özgün / Yaratıcı Konseptler (6 - 10)
  {
    id: "island",
    number: "6",
    nameKey: "home.variants.island",
    descKey: "home.variants.islandDesc",
    group: "creative",
  },
  {
    id: "cinema",
    number: "7",
    nameKey: "home.variants.cinema",
    descKey: "home.variants.cinemaDesc",
    group: "creative",
  },
  {
    id: "bento",
    number: "8",
    nameKey: "home.variants.bento",
    descKey: "home.variants.bentoDesc",
    group: "creative",
  },
  {
    id: "terminal",
    number: "9",
    nameKey: "home.variants.terminal",
    descKey: "home.variants.terminalDesc",
    group: "creative",
  },
  {
    id: "zen",
    number: "10",
    nameKey: "home.variants.zen",
    descKey: "home.variants.zenDesc",
    group: "creative",
  },

  // Klasik Panel Tasarımları (1 - 5 + Orijinal)
  {
    id: "minimal",
    number: "1",
    nameKey: "home.variants.minimal",
    descKey: "home.variants.minimalDesc",
    group: "dashboard",
  },
  {
    id: "split",
    number: "2",
    nameKey: "home.variants.split",
    descKey: "home.variants.splitDesc",
    group: "dashboard",
  },
  {
    id: "cards",
    number: "3",
    nameKey: "home.variants.cards",
    descKey: "home.variants.cardsDesc",
    group: "dashboard",
  },
  {
    id: "dropzone",
    number: "4",
    nameKey: "home.variants.dropzone",
    descKey: "home.variants.dropzoneDesc",
    group: "dashboard",
  },
  {
    id: "toolbelt",
    number: "5",
    nameKey: "home.variants.toolbelt",
    descKey: "home.variants.toolbeltDesc",
    group: "dashboard",
  },
  {
    id: "spotlight",
    number: "★",
    nameKey: "home.variants.spotlight",
    descKey: "home.variants.spotlightDesc",
    group: "dashboard",
  },
]
