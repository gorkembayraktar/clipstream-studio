/** Sahnenin sol üstündeki kırpma menüsü: açma/kapama, oran ön ayarları ve boyut. */
import { useState } from "react"

import { CheckIcon, ChevronDownIcon, CropIcon, Grid2X2Icon, RotateCcwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "cn"
import { useI18n, type TranslationKey } from "@/i18n"
import type { AspectPreset } from "@/lib/types"
import { useEditStore } from "@/stores/edit-store"

const PRESETS: { value: AspectPreset; label: string; labelKey?: TranslationKey }[] = [
  { value: "free", label: "", labelKey: "crop.free" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
]

export function CropMenu() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const crop = useEditStore((s) => s.crop)
  const setCropEnabled = useEditStore((s) => s.setCropEnabled)
  const setCropAspect = useEditStore((s) => s.setCropAspect)
  const setCropRect = useEditStore((s) => s.setCropRect)

  const rect = crop.rect
  const choosePreset = (preset: AspectPreset) => {
    setCropAspect(preset)
    if (!crop.enabled) setCropEnabled(true)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          data-slot="crop-menu-trigger"
          variant="ghost"
          size="icon-sm"
          aria-label={t("crop.label")}
          title={t("crop.label")}
          onDoubleClick={(event) => event.stopPropagation()}
          className={cn(
            "relative bg-black/50 text-white/80 shadow-[0_2px_10px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur-sm hover:bg-black/70 hover:text-white",
            crop.enabled && "bg-black/70 text-white ring-emerald-400/60",
          )}
        >
          <Grid2X2Icon />
          <ChevronDownIcon className="absolute right-1 bottom-0.5 size-2.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={6}
        container={
          open && document.fullscreenElement instanceof HTMLElement
            ? document.fullscreenElement
            : null
        }
        className="w-56"
      >
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault()
            setCropEnabled(!crop.enabled)
          }}
        >
          <CropIcon />
          <span>{t("crop.label")}</span>
          {crop.enabled && <CheckIcon className="ml-auto" />}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <div className="px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          {t("crop.aspect")}
        </div>
        {PRESETS.map((preset) => (
          <DropdownMenuItem
            key={preset.value}
            onSelect={() => choosePreset(preset.value)}
            className="justify-between"
          >
            <span>{preset.labelKey ? t(preset.labelKey) : preset.label}</span>
            {crop.aspect === preset.value && <CheckIcon />}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={() => setCropRect(null)}
          disabled={!crop.enabled}
        >
          <RotateCcwIcon />
          <span>{t("crop.full")}</span>
        </DropdownMenuItem>
        {crop.enabled && rect && (
          <div className="px-2 py-1 font-mono text-[10px] text-muted-foreground">
            {rect.width}×{rect.height} @ {rect.x},{rect.y}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
