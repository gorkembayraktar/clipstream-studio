import { useState, useEffect } from "react"

import { HomeSpotlight } from "@/components/app/home-spotlight"
import { type HomeVariantId } from "@/components/app/home-variants/types"
import { VariantBento } from "@/components/app/home-variants/variant-bento"
import { VariantBroadcast } from "@/components/app/home-variants/variant-broadcast"
import { VariantCards } from "@/components/app/home-variants/variant-cards"
import { VariantCinema } from "@/components/app/home-variants/variant-cinema"
import { VariantDaw } from "@/components/app/home-variants/variant-daw"
import { VariantDock } from "@/components/app/home-variants/variant-dock"
import { VariantDropzone } from "@/components/app/home-variants/variant-dropzone"
import { VariantHud } from "@/components/app/home-variants/variant-hud"
import { VariantIsland } from "@/components/app/home-variants/variant-island"
import { VariantLauncher } from "@/components/app/home-variants/variant-launcher"
import { VariantMinimal } from "@/components/app/home-variants/variant-minimal"
import { VariantNativeModal } from "@/components/app/home-variants/variant-native-modal"
import { VariantNle } from "@/components/app/home-variants/variant-nle"
import { VariantResolve } from "@/components/app/home-variants/variant-resolve"
import { VariantSplit } from "@/components/app/home-variants/variant-split"
import { VariantStage } from "@/components/app/home-variants/variant-stage"
import { VariantSwitcher } from "@/components/app/home-variants/variant-switcher"
import { VariantTerminal } from "@/components/app/home-variants/variant-terminal"
import { VariantToolbelt } from "@/components/app/home-variants/variant-toolbelt"
import { VariantWorkbench } from "@/components/app/home-variants/variant-workbench"
import { VariantZen } from "@/components/app/home-variants/variant-zen"

const STORAGE_KEY = "clipstream_home_variant"
const DEFAULT_VARIANT: HomeVariantId = "broadcast"

export function HomeScreen() {
  const [variant, setVariant] = useState<HomeVariantId>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as HomeVariantId | null
      if (
        saved === "broadcast" ||
        saved === "hud" ||
        saved === "stage" ||
        saved === "dock" ||
        saved === "workbench" ||
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
      {/* 5 En Yeni Yayın & Donanım Stüdyo Arayüzü (16 - 20) */}
      {variant === "broadcast" && <VariantBroadcast />}
      {variant === "hud" && <VariantHud />}
      {variant === "stage" && <VariantStage />}
      {variant === "dock" && <VariantDock />}
      {variant === "workbench" && <VariantWorkbench />}

      {/* Masaüstü Yazılım Karşılama Ekranları (11 - 15) */}
      {variant === "nle" && <VariantNle />}
      {variant === "resolve" && <VariantResolve />}
      {variant === "launcher" && <VariantLauncher />}
      {variant === "native-modal" && <VariantNativeModal />}
      {variant === "daw" && <VariantDaw />}

      {/* Yaratıcı Konseptler (6 - 10) */}
      {variant === "island" && <VariantIsland />}
      {variant === "cinema" && <VariantCinema />}
      {variant === "bento" && <VariantBento />}
      {variant === "terminal" && <VariantTerminal />}
      {variant === "zen" && <VariantZen />}

      {/* Klasik Paneller (1 - 5 + Orijinal) */}
      {variant === "minimal" && <VariantMinimal />}
      {variant === "split" && <VariantSplit />}
      {variant === "cards" && <VariantCards />}
      {variant === "dropzone" && <VariantDropzone />}
      {variant === "toolbelt" && <VariantToolbelt />}
      {variant === "spotlight" && <HomeSpotlight />}

      {/* Canlı UI Değiştirici */}
      <VariantSwitcher current={variant} onChange={setVariant} />
    </div>
  )
}
