export type HomeVariantId =
  | "minimal"
  | "split"
  | "cards"
  | "dropzone"
  | "toolbelt"
  | "island"
  | "cinema"
  | "bento"
  | "terminal"
  | "zen"
  | "spotlight"

export interface VariantMeta {
  id: HomeVariantId
  number: string
  nameKey: string
  descKey: string
  badge?: string
}

export const HOME_VARIANTS: VariantMeta[] = [
  // 5 Yeni Özgün Tasarım
  {
    id: "island",
    number: "6",
    nameKey: "home.variants.island",
    descKey: "home.variants.islandDesc",
    badge: "New",
  },
  {
    id: "cinema",
    number: "7",
    nameKey: "home.variants.cinema",
    descKey: "home.variants.cinemaDesc",
    badge: "New",
  },
  {
    id: "bento",
    number: "8",
    nameKey: "home.variants.bento",
    descKey: "home.variants.bentoDesc",
    badge: "New",
  },
  {
    id: "terminal",
    number: "9",
    nameKey: "home.variants.terminal",
    descKey: "home.variants.terminalDesc",
    badge: "New",
  },
  {
    id: "zen",
    number: "10",
    nameKey: "home.variants.zen",
    descKey: "home.variants.zenDesc",
    badge: "New",
  },

  // Önceki 5 Tasarım
  {
    id: "minimal",
    number: "1",
    nameKey: "home.variants.minimal",
    descKey: "home.variants.minimalDesc",
  },
  {
    id: "split",
    number: "2",
    nameKey: "home.variants.split",
    descKey: "home.variants.splitDesc",
  },
  {
    id: "cards",
    number: "3",
    nameKey: "home.variants.cards",
    descKey: "home.variants.cardsDesc",
  },
  {
    id: "dropzone",
    number: "4",
    nameKey: "home.variants.dropzone",
    descKey: "home.variants.dropzoneDesc",
  },
  {
    id: "toolbelt",
    number: "5",
    nameKey: "home.variants.toolbelt",
    descKey: "home.variants.toolbeltDesc",
  },
  {
    id: "spotlight",
    number: "★",
    nameKey: "home.variants.spotlight",
    descKey: "home.variants.spotlightDesc",
  },
]
