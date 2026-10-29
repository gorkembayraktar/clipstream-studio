import { useState } from "react"
import {
  ChevronDown,
  ChevronUp,
  LayoutTemplate,
  Monitor,
  Radio,
  Sparkles,
  ArrowUpDown,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { useI18n } from "@/i18n"
import { cn } from "cn"

import { HOME_VARIANTS, type HomeVariantId } from "./types"

export function VariantSwitcher({
  current,
  onChange,
}: {
  current: HomeVariantId
  onChange: (id: HomeVariantId) => void
}) {
  const { t } = useI18n()
  const [collapsed, setCollapsed] = useState(false)
  const [position, setPosition] = useState<"bottom" | "top">("bottom")

  const activeMeta =
    HOME_VARIANTS.find((v) => v.id === current) ?? HOME_VARIANTS[0]

  const hardwareVariants = HOME_VARIANTS.filter((v) => v.group === "hardware-studio")
  const appWelcomeVariants = HOME_VARIANTS.filter((v) => v.group === "app-welcome")
  const creativeVariants = HOME_VARIANTS.filter((v) => v.group === "creative")
  const dashboardVariants = HOME_VARIANTS.filter((v) => v.group === "dashboard")

  return (
    <aside
      aria-label="UI Variant Switcher"
      className={cn(
        "fixed left-1/2 z-50 -translate-x-1/2 transition-all duration-300 max-w-[96vw]",
        position === "bottom" ? "bottom-3" : "top-14",
      )}
    >
      <div className="flex flex-col items-center rounded-2xl border border-border/80 bg-card/95 p-2 shadow-2xl backdrop-blur-xl ring-1 ring-black/10 dark:ring-white/10">
        {/* Başlık, Aktif Tasarım ve Pozisyon Kontrolü */}
        <div className="flex w-full items-center justify-between gap-3 px-2 py-0.5 text-xs">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <LayoutTemplate className="size-3.5 text-primary" />
            <span className="font-bold text-primary">UI Seçimi:</span>
            <span className="rounded-md bg-primary/10 px-2 py-0.5 font-semibold text-primary">
              #{activeMeta.number} {t(activeMeta.nameKey as any)}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="hidden text-[11px] text-muted-foreground lg:inline max-w-sm truncate">
              {t(activeMeta.descKey as any)}
            </span>

            {/* Pozisyonu yukarı / aşağı alma */}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setPosition(position === "bottom" ? "top" : "bottom")}
              className="text-muted-foreground hover:text-foreground"
              title={position === "bottom" ? "Yukarı taşı" : "Aşağı taşı"}
            >
              <ArrowUpDown className="size-3" />
            </Button>

            {/* Daralt / Genişlet */}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setCollapsed(!collapsed)}
              className="text-muted-foreground"
              title={collapsed ? "Genişlet" : "Daralt"}
            >
              {collapsed ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </Button>
          </div>
        </div>

        {/* Seçenek Düğmeleri */}
        {!collapsed && (
          <div className="mt-1.5 flex flex-col gap-1.5 border-t border-border/40 pt-1.5">
            {/* 1. Grup: 5 En Yeni Yayın & Donanım Stüdyo Tasarımı (16 - 20) */}
            <div className="flex flex-wrap items-center justify-center gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary mr-1 flex items-center gap-1">
                <Radio className="size-3 text-rose-500 animate-pulse" /> En Yeni (16-20):
              </span>
              {hardwareVariants.map((v) => {
                const active = v.id === current
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => onChange(v.id)}
                    className={cn(
                      "flex items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-semibold transition-all duration-200",
                      active
                        ? "bg-rose-600 text-white shadow-md scale-105"
                        : "bg-muted/60 text-foreground hover:bg-muted",
                    )}
                    title={t(v.descKey as any)}
                  >
                    <span className="flex size-4 items-center justify-center rounded-full text-[10px] font-bold">
                      {v.number}
                    </span>
                    <span>{t(v.nameKey as any).replace(/^\d+\.\s*/, "")}</span>
                  </button>
                )
              })}
            </div>

            {/* 2. Grup: Masaüstü Uygulama Başlangıç Ekranları (11 - 15) */}
            <div className="flex flex-wrap items-center justify-center gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mr-1 flex items-center gap-1">
                <Monitor className="size-3" /> Masaüstü (11-15):
              </span>
              {appWelcomeVariants.map((v) => {
                const active = v.id === current
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => onChange(v.id)}
                    className={cn(
                      "flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium transition-all",
                      active
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    title={t(v.descKey as any)}
                  >
                    <span>{v.number}</span>
                    <span>{t(v.nameKey as any).replace(/^\d+\.\s*/, "")}</span>
                  </button>
                )
              })}
            </div>

            {/* 3. Grup: Diğer Konseptler (1 - 10) */}
            <div className="flex flex-wrap items-center justify-center gap-1 opacity-60 hover:opacity-100 transition-opacity">
              <span className="text-[10px] text-muted-foreground mr-1 flex items-center gap-1">
                <Sparkles className="size-2.5" /> Diğerleri (1-10):
              </span>
              {[...creativeVariants, ...dashboardVariants].map((v) => {
                const active = v.id === current
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => onChange(v.id)}
                    className={cn(
                      "flex items-center gap-1 rounded px-1.5 py-0.2 text-[10px] transition-all",
                      active
                        ? "bg-secondary text-secondary-foreground font-bold"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    title={t(v.descKey as any)}
                  >
                    <span>{v.number}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
