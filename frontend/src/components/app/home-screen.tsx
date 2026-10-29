import { useState, useEffect } from "react"

import { HomeSpotlight } from "@/components/app/home-spotlight"
import { type HomeVariantId } from "@/components/app/home-variants/types"
import { VariantBento } from "@/components/app/home-variants/variant-bento"
import { VariantCards } from "@/components/app/home-variants/variant-cards"
import { VariantCinema } from "@/components/app/home-variants/variant-cinema"
import { VariantDropzone } from "@/components/app/home-variants/variant-dropzone"
import { VariantIsland } from "@/components/app/home-variants/variant-island"
import { VariantMinimal } from "@/components/app/home-variants/variant-minimal"
import { VariantSplit } from "@/components/app/home-variants/variant-split"
import { VariantSwitcher } from "@/components/app/home-variants/variant-switcher"
import { VariantTerminal } from "@/components/app/home-variants/variant-terminal"
import { VariantToolbelt } from "@/components/app/home-variants/variant-toolbelt"
import { VariantZen } from "@/components/app/home-variants/variant-zen"

const STORAGE_KEY = "clipstream_home_variant"
const DEFAULT_VARIANT: HomeVariantId = "island"

export function HomeScreen() {
  const [variant, setVariant] = useState<HomeVariantId>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as HomeVariantId | null
      if (
        saved === "island" ||
        saved === "cinema" ||
        saved === "bento" ||
        saved === "terminal" ||
        saved === "zen" ||
        saved === "minimal" ||
        saved === "split" ||
        saved === "cards" ||
        saved === "dropzone" ||
        saved === "toolbelt" ||
        saved === "spotlight"
      ) {
        return saved
      }
    } catch {
      // localStorage erişilemezse varsayılan kullanılır
    }
    return DEFAULT_VARIANT
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, variant)
    } catch {
      // yok say
    }
  }, [variant])

  return (
    <div data-slot="home-screen" className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* 5 Yeni Özgün Tasarım */}
      {variant === "island" && <VariantIsland />}
      {variant === "cinema" && <VariantCinema />}
      {variant === "bento" && <VariantBento />}
      {variant === "terminal" && <VariantTerminal />}
      {variant === "zen" && <VariantZen />}

      {/* Önceki Tasarımlar */}
      {variant === "minimal" && <VariantMinimal />}
      {variant === "split" && <VariantSplit />}
      {variant === "cards" && <VariantCards />}
      {variant === "dropzone" && <VariantDropzone />}
      {variant === "toolbelt" && <VariantToolbelt />}
      {variant === "spotlight" && <HomeSpotlight />}

      {/* Canlı UI Değiştirici Çubuğu */}
      <VariantSwitcher current={variant} onChange={setVariant} />
    </div>
  )
}
