/** Kare önizleme balonu: storyboard'daki en yakın kareyi gösterir.
 *
 * Ana çizelge ve kaynak şeridi aynı balonu kullanır.
 */
import type { CSSProperties } from "react"

import { Loader2Icon } from "lucide-react"

import { useI18n } from "@/i18n"
import { formatTime } from "@/lib/format"
import type { StoryboardMeta } from "@/lib/types"

/** Kare önizleme balonunun ölçüleri (px) — sunucu da bu ölçüde üretir. */
export const PREVIEW_WIDTH = 160
export const PREVIEW_HEIGHT = 90

/** Yüklenen gruplar arasından zamana en yakın kareyi CSS ile kırpar. */
function storyboardFrame(meta: StoryboardMeta, time: number) {
  let selected: { batch: StoryboardMeta["batches"][number]; index: number } | null = null
  let selectedDistance = Infinity

  for (const batch of meta.batches) {
    for (let index = 0; index < batch.times.length; index += 1) {
      const distance = Math.abs(batch.times[index] - time)
      if (distance < selectedDistance) {
        selectedDistance = distance
        selected = { batch, index }
      }
    }
  }

  if (!selected) return null
  const { batch, index } = selected
  const column = index % batch.columns
  const row = Math.floor(index / batch.columns)

  return {
    /** Kareyi temsil eden zaman (yaklaşık). */
    time: batch.times[index],
    style: {
      width: batch.tile_width,
      height: batch.tile_height,
      backgroundImage: `url("${batch.sheet_url}")`,
      backgroundSize: `${batch.columns * batch.tile_width}px ${batch.rows * batch.tile_height}px`,
      backgroundPosition: `-${column * batch.tile_width}px -${row * batch.tile_height}px`,
      backgroundRepeat: "no-repeat",
    } satisfies CSSProperties,
  }
}

interface TimelinePreviewProps {
  /** Balonun sol kenarı (px, kapsayıcıya göre). */
  left: number
  /** Önizlenen kaynak zamanı (sn). */
  time: number
  meta: StoryboardMeta | null
  failed: boolean
}

export function TimelinePreview({ left, time, meta, failed }: TimelinePreviewProps) {
  const { t } = useI18n()
  const tile = meta ? storyboardFrame(meta, time) : null

  return (
    <div
      data-slot="timeline-preview"
      className="pointer-events-none absolute bottom-[calc(100%+6px)] z-40 -translate-x-1/2"
      style={{ left: `${left}px` }}
    >
      <div className="overflow-hidden rounded-md border border-border/70 bg-black shadow-xl">
        <div className="relative" style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }}>
          {tile ? (
            <div style={tile.style} aria-hidden />
          ) : failed ? (
            <div className="flex h-full w-full items-center justify-center px-3 text-center text-[10px] leading-tight text-white/60">
              {t("timeline.storyboardFailed")}
            </div>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-[10px] text-white/60">
              <Loader2Icon className="size-4 animate-spin text-white/80" />
              {t("timeline.storyboardLoading")}
            </div>
          )}
        </div>
      </div>
      <div className="mt-1 w-40 rounded bg-black/85 px-1.5 py-0.5 text-center font-mono text-[10px] text-white/90">
        <div>{formatTime(time, true)}</div>
        {tile && Math.abs(tile.time - time) >= 0.05 && (
          <div className="text-[9px] text-white/50">≈{formatTime(tile.time, true)}</div>
        )}
      </div>
    </div>
  )
}
