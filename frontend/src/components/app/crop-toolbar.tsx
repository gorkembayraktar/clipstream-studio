/** Kırpma araç çubuğu: açma/kapama, oran ön ayarları, boyut bilgisi.
 *
 * Videonun üzerini kapatmaması için sahnenin altındaki kontroller şeridinde durur.
 */
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { cn } from "cn"
import type { AspectPreset } from "@/lib/types"
import { useStudioStore } from "@/stores/studio-store"

const PRESETS: { value: AspectPreset; label: string }[] = [
  { value: "free", label: "Serbest" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
]

export function CropToolbar() {
  const crop = useStudioStore((s) => s.crop)
  const setCropEnabled = useStudioStore((s) => s.setCropEnabled)
  const setCropAspect = useStudioStore((s) => s.setCropAspect)
  const setCropRect = useStudioStore((s) => s.setCropRect)

  const rect = crop.rect

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium">
        <Switch checked={crop.enabled} onCheckedChange={setCropEnabled} />
        Kırpma
      </label>

      {crop.enabled && (
        <>
          <div className="h-4 w-px bg-border" />

          <div className="flex items-center gap-1">
            {PRESETS.map((preset) => (
              <Button
                key={preset.value}
                size="xs"
                variant={crop.aspect === preset.value ? "secondary" : "ghost"}
                className={cn(
                  "h-6 px-2 text-[11px]",
                  crop.aspect !== preset.value && "text-muted-foreground",
                )}
                onClick={() => setCropAspect(preset.value)}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          <Button
            size="xs"
            variant="ghost"
            className="h-6 px-2 text-[11px] text-muted-foreground"
            onClick={() => setCropRect(null)}
          >
            Tam Kare
          </Button>

          {rect && (
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">
              {rect.width}×{rect.height} @ {rect.x},{rect.y}
            </span>
          )}
        </>
      )}
    </div>
  )
}
