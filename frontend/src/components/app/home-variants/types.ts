export type HomeVariantId =
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
}

export const HOME_VARIANTS: VariantMeta[] = [
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
