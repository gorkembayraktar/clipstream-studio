/** Ana sayfa: tek odaklı sinematik kaynak girişi ve son projeler. */
import { HomeSpotlight } from "@/components/app/home-spotlight"

export function HomeScreen() {
  return (
    <div data-slot="home-screen" className="flex min-h-0 flex-1 flex-col">
      <HomeSpotlight />
    </div>
  )
}
