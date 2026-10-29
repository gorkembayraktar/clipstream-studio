import { useState, useEffect } from "react"

import { HomeSpotlight } from "@/components/app/home-spotlight"
import { type HomeVariantId } from "@/components/app/home-variants/types"
import { VariantCards } from "@/components/app/home-variants/variant-cards"
import { VariantDropzone } from "@/components/app/home-variants/variant-dropzone"
import { VariantMinimal } from "@/components/app/home-variants/variant-minimal"
import { VariantSplit } from "@/components/app/home-variants/variant-split"
import { VariantSwitcher } from "@/components/app/home-variants/variant-switcher"
import { VariantToolbelt } from "@/components/app/home-variants/variant-toolbelt"

const STORAGE_KEY = "clipstream_home_variant"
const DEFAULT_VARIANT: HomeVariantId = "minimal"

export function HomeScreen() {
  const [variant, setVariant] = useState<HomeVariantId>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as HomeVariantId | null
      if (
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
      {variant === "minimal" && <VariantMinimal />}
      {variant === "split" && <VariantSplit />}
      {variant === "cards" && <VariantCards />}
      {variant === "dropzone" && <VariantDropzone />}
      {variant === "toolbelt" && <VariantToolbelt />}
      {variant === "spotlight" && <HomeSpotlight />}

      {/* 5 Tasarım Arasında Geçiş Yapma Çubuğu */}
      <VariantSwitcher current={variant} onChange={setVariant} />
    </div>
  )
}
