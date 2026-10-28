/** Proje adının yanındaki bilgi düğmesi: kaynak/video künyesini gösterir. */
import { InfoIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useI18n } from "@/i18n"
import { formatClock, formatFrameRate, sourceDisplayName } from "@/lib/format"
import { usePlayerStore } from "@/stores/player-store"
import { useSourceStore } from "@/stores/source-store"
import { cn } from "cn"

export function ProjectInfoPopover() {
  const { t } = useI18n()
  const title = useSourceStore((s) => s.title)
  const inputUrl = useSourceStore((s) => s.inputUrl)
  const originUrl = useSourceStore((s) => s.sourceOrigin)
  const sourcePath = useSourceStore((s) => s.sourcePath)
  const resolution = useSourceStore((s) => s.resolution)
  const meta = useSourceStore((s) => s.meta)
  const platform = useSourceStore((s) => s.platform)
  const isHls = useSourceStore((s) => s.isHls)
  const isLive = useSourceStore((s) => s.isLive)
  const playerDuration = usePlayerStore((s) => s.duration)

  const name = sourceDisplayName(title, inputUrl)
  const duration =
    meta && meta.duration > 0 ? meta.duration : playerDuration > 0 ? playerDuration : 0
  const dimensions =
    meta && meta.width > 0 && meta.height > 0
      ? `${meta.width} × ${meta.height}`
      : resolution
  const frameRate = meta?.fps ? formatFrameRate(meta.fps) : ""
  const audio = meta
    ? meta.hasAudio
      ? t("project.infoYes")
      : t("project.infoNo")
    : ""
  const location = sourcePath || originUrl || inputUrl || ""

  const platformLabel =
    platform === "youtube"
      ? t("source.platformYoutube")
      : platform === "twitter"
        ? t("source.platformX")
        : platform === "instagram"
          ? t("source.platformInstagram")
          : platform === "tiktok"
            ? t("source.platformTiktok")
            : platform === "ytdlp"
              ? t("source.platformYtdlp")
              : platform === "local"
                ? t("project.infoLocal")
                : t("project.infoRemote")
  const kind = isLive
    ? t("project.infoLive")
    : isHls
      ? t("project.infoHls")
      : platformLabel

  const rows: Array<{ label: string; value: string; mono?: boolean }> = []
  if (name) rows.push({ label: t("project.infoName"), value: name })
  if (!isLive && duration > 0) {
    rows.push({ label: t("project.infoDuration"), value: formatClock(duration) })
  }
  if (dimensions) {
    rows.push({ label: t("project.infoResolution"), value: dimensions })
  }
  if (frameRate) {
    rows.push({ label: t("project.infoFrameRate"), value: frameRate })
  }
  if (audio) rows.push({ label: t("project.infoAudio"), value: audio })
  rows.push({ label: t("project.infoType"), value: kind })
  if (location) {
    rows.push({ label: t("project.infoLocation"), value: location, mono: true })
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted-foreground"
          aria-label={t("project.infoTitle")}
          title={t("project.infoTitle")}
        >
          <InfoIcon />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        data-slot="project-info"
        align="start"
        aria-label={t("project.infoTitle")}
        className="w-72"
      >
        <div className="flex items-center gap-1.5 border-b border-border/60 pb-2">
          <InfoIcon className="size-3.5 text-muted-foreground" />
          <p className="text-xs font-semibold">{t("project.infoTitle")}</p>
        </div>

        {rows.length === 0 ? (
          <p className="pt-2 text-[11px] leading-relaxed text-muted-foreground">
            {t("project.infoEmpty")}
          </p>
        ) : (
          <dl className="mt-2 space-y-1.5">
            {rows.map((row) => (
              <div
                key={row.label}
                className="grid grid-cols-[5.5rem_1fr] items-baseline gap-2"
              >
                <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">
                  {row.label}
                </dt>
                <dd
                  className={cn(
                    "truncate text-[11px] font-medium text-foreground/90",
                    row.mono && "font-mono text-[10px]",
                  )}
                  title={row.value}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </PopoverContent>
    </Popover>
  )
}
