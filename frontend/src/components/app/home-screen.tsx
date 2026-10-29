import { useState, useEffect } from "react"

import { HomeSpotlight } from "@/components/app/home-spotlight"
import { type HomeVariantId } from "@/components/app/home-variants/types"
import { VariantBento } from "@/components/app/home-variants/variant-bento"
import { VariantCards } from "@/components/app/home-variants/variant-cards"
import { VariantCinema } from "@/components/app/home-variants/variant-cinema"
import { VariantDaw } from "@/components/app/home-variants/variant-daw"
import { VariantDropzone } from "@/components/app/home-variants/variant-dropzone"
import { VariantIsland } from "@/components/app/home-variants/variant-island"
import { VariantLauncher } from "@/components/app/home-variants/variant-launcher"
import { VariantMinimal } from "@/components/app/home-variants/variant-minimal"
import { VariantNativeModal } from "@/components/app/home-variants/variant-native-modal"
import { VariantNle } from "@/components/app/home-variants/variant-nle"
import { VariantResolve } from "@/components/app/home-variants/variant-resolve"
import { VariantSplit } from "@/components/app/home-variants/variant-split"
import { VariantSwitcher } from "@/components/app/home-variants/variant-switcher"
import { VariantTerminal } from "@/components/app/home-variants/variant-terminal"
import { VariantToolbelt } from "@/components/app/home-variants/variant-toolbelt"
import { VariantZen } from "@/components/app/home-variants/variant-zen"

const STORAGE_KEY = "clipstream_home_variant"
const DEFAULT_VARIANT: HomeVariantId = "nle"

export function HomeScreen() {
  const [variant, setVariant] = useState<HomeVariantId>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as HomeVariantId | null
      if (
        saved === "nle" ||
        saved === "resolve" ||
        saved === "launcher" ||
        saved === "native-modal" ||
        saved === "daw" ||
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
      {/* 5 Masaüstü / Yazılım Karşılama Ekranı (Application Start Screens) */}
      {variant === "nle" && <VariantNle />}
      {variant === "resolve" && <VariantResolve />}
      {variant === "launcher" && <VariantLauncher />}
      {variant === "native-modal" && <VariantNativeModal />}
      {variant === "daw" && <VariantDaw />}

      {/* Özgün / Yaratıcı Konseptler */}
      {variant === "island" && <VariantIsland />}
      {variant === "cinema" && <VariantCinema />}
      {variant === "bento" && <VariantBento />}
      {variant === "terminal" && <VariantTerminal />}
      {variant === "zen" && <VariantZen />}

      {/* Klasik Paneller */}
      {variant === "minimal" && <VariantMinimal />}
      {variant === "split" && <VariantSplit />}
      {variant === "cards" && <VariantCards />}
      {variant === "dropzone" && <VariantDropzone />}
      {variant === "toolbelt" && <VariantToolbelt />}
      {variant === "spotlight" && <HomeSpotlight />}

      {/* Canlı Karşılama Arayüzü Değiştirici */}
      <VariantSwitcher current={variant} onChange={setVariant} />
    </div>
  )
}
