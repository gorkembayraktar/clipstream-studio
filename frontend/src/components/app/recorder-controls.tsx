/** Sahne kontrollerindeki canlı kayıt düğmesi.
 *
 * Kayıt bir "panel" değil, sahnenin kendi eylemidir: başlat/durdur/duraklat ve
 * süre sayacı. Biten kayıtlar ayrı bir listede birikmez; doğrudan zaman
 * çizelgesinin blokları olurlar (silme de oradan yapılır).
 */
import { PauseIcon, PlayIcon, CircleIcon, SquareIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useRecorder } from "@/hooks/use-recorder"
import { useI18n } from "@/i18n"
import { formatClock } from "@/lib/format"
import { usePlayerStore } from "@/stores/player-store"
import { useRecorderStore } from "@/stores/recorder-store"
import { useSourceStore } from "@/stores/source-store"
import { cn } from "cn"

/** Koyu sahne üzerinde okunabilen düğme zemini (stage-controls ile aynı). */
const OVERLAY_CONTROL =
  "bg-black/50 text-white/80 shadow-[0_2px_10px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur-sm hover:bg-black/70 hover:text-white"

/** Adres gerçekten bir yayın mı (yerel dosya yolu değil)? */
function isRemote(url: string): boolean {
  return /^https?:\/\//i.test(url.trim())
}

export function RecorderControls() {
  useRecorder()
  const { t } = useI18n()
  const isLive = useSourceStore((s) => s.isLive)
  const streamId = useSourceStore((s) => s.streamId)
  const liveUrl = useSourceStore((s) => s.liveUrl)
  const inputUrl = useSourceStore((s) => s.inputUrl)
  // Resolver doğrudan HLS akışlarını "canlı" işaretlemez; oynatıcı canlı
  // playlist gördüğünde de kayıt sunulur (backend playlist'i yeniden doğrular).
  const playerLive = usePlayerStore((s) => s.live)
  const recordings = useRecorderStore((s) => s.recordings)
  const busy = useRecorderStore((s) => s.busy)
  const start = useRecorderStore((s) => s.start)
  const stop = useRecorderStore((s) => s.stop)
  const pause = useRecorderStore((s) => s.pause)
  const resume = useRecorderStore((s) => s.resume)

  // Proje başına tek etkin kayıt vardır (backend de ikinciyi reddeder).
  const active = recordings[0] ?? null
  const paused = active?.status === "paused"

  // Akış kaynağı açıkken canlı yayın adresi `liveUrl`'de saklanır; proje geri
  // yüklendiyse adres kayıt başlarken tembel çözülür.
  const hasLiveInput =
    isLive ||
    playerLive ||
    (Boolean(streamId) &&
      (Boolean(liveUrl) || isRemote(inputUrl)))

  if (!active && !hasLiveInput) return null

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        data-slot="record-button"
        onClick={() => {
          if (active) void stop(active.id)
          else void start()
        }}
        disabled={busy}
        title={active ? t("record.stopTitle") : t("record.startTitle")}
        aria-label={active ? t("record.stop") : t("record.startTitle")}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-md px-2 font-sans text-[11px] font-semibold tracking-wide whitespace-nowrap shadow-[0_2px_10px_rgba(0,0,0,0.45)] ring-1 backdrop-blur-sm disabled:opacity-70",
          active
            ? "bg-red-600/85 text-white ring-red-300/30 hover:bg-red-600"
            : "bg-black/50 text-white/85 ring-white/10 hover:bg-black/70 hover:text-white",
        )}
      >
        {active ? (
          <SquareIcon className="size-3 fill-current" />
        ) : (
          <CircleIcon className="size-3.5 fill-current text-red-500" />
        )}
        <span className="tabular-nums">
          {active ? formatClock(active.duration) : t("record.start")}
        </span>
      </button>

      {active ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void (paused ? resume(active.id) : pause(active.id))}
          disabled={busy}
          aria-label={paused ? t("record.resume") : t("record.pause")}
          title={paused ? t("record.resumeTitle") : t("record.pauseTitle")}
          className={cn(OVERLAY_CONTROL, paused && "text-emerald-300")}
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
        </Button>
      ) : null}
    </div>
  )
}
