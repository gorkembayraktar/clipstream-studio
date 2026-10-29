import { useState } from "react"
import { ChevronDown, ChevronUp, Sparkles, LayoutTemplate } from "lucide-react"

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

  const activeMeta =
    HOME_VARIANTS.find((v) => v.id === current) ?? HOME_VARIANTS[0]

  return (
    <aside
      aria-label="UI Variant Switcher"
      className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 transition-all duration-300"
    >
      <div className="flex flex-col items-center rounded-2xl border border-border/80 bg-card/90 p-1.5 shadow-xl backdrop-blur-xl ring-1 ring-black/5 dark:ring-white/10 max-w-[95vw]">
        {/* Başlık ve Durum Şeridi */}
        <div className="flex w-full items-center justify-between gap-3 px-2 py-1 text-xs">
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            <LayoutTemplate className="size-3.5 text-primary" />
            <span className="font-semibold">{t("home.variants.switcherLabel")}</span>
            <span className="text-muted-foreground hidden sm:inline">
              ({activeMeta.number}) {t(activeMeta.nameKey as any)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden text-[11px] text-muted-foreground/80 md:inline">
              {t(activeMeta.descKey as any)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setCollapsed(!collapsed)}
              className="text-muted-foreground"
              title={collapsed ? "Expand Switcher" : "Collapse Switcher"}
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
          <div className="mt-1 flex flex-wrap items-center justify-center gap-1 border-t border-border/40 pt-1.5">
            {HOME_VARIANTS.map((v) => {
              const active = v.id === current
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onChange(v.id)}
                  className={cn(
                    "flex items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-medium transition-all duration-200",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm scale-100"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  title={t(v.descKey as any)}
                >
                  {v.id === "spotlight" ? (
                    <Sparkles className="size-3" />
                  ) : (
                    <span
                      className={cn(
                        "flex size-4 items-center justify-center rounded-full text-[10px] font-bold",
                        active
                          ? "bg-primary-foreground/20 text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {v.number}
                    </span>
                  )}
                  <span>{t(v.nameKey as any)}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}
