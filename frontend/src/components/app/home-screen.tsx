/** Ana sayfa: tek ekran — "Desktop Launcher" karşılama düzeni. */
import { HomeLauncher } from "@/components/app/home-launcher"

export function HomeScreen() {
  return (
    <div data-slot="home-screen" className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <HomeLauncher />
    </div>
  )
}
