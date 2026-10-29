import { ShieldCheck, Zap, HardDrive } from "lucide-react"

import {
  ImportProgressCard,
  ResolveProgressCard,
  SourceSummaryCard,
} from "@/components/app/source-panels"
import { useI18n } from "@/i18n"

export const SUPPORTED_PLATFORMS = [
  "YouTube",
  "Twitch",
  "TikTok",
  "Kick",
  "X / Twitter",
  "Instagram",
  "Vimeo",
  "HLS / m3u8",
  "Direct MP4",
]

export function ResolveStatusView({
  resolving,
  progress,
  stage,
  detail,
  onCancel,
  hasInputUrl,
}: {
  resolving: boolean
  progress: number | null
  stage: string | null
  detail: string
  onCancel: () => void
  hasInputUrl: boolean
}) {
  if (!resolving && !hasInputUrl) return null

  return (
    <div className="w-full space-y-2">
      {resolving && (
        <ResolveProgressCard
          progress={progress}
          stage={stage}
          detail={detail}
          onCancel={onCancel}
        />
      )}
      <ImportProgressCard />
      <SourceSummaryCard />
    </div>
  )
}

export function StudioSecurityPill() {
  const { t } = useI18n()
  return (
    <div className="inline-flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground/80">
      <span className="flex items-center gap-1.5">
        <ShieldCheck className="size-3.5 text-emerald-500" />
        {t("home.localNote")}
      </span>
      <span className="hidden size-1 rounded-full bg-border sm:inline-block" />
      <span className="hidden items-center gap-1.5 sm:inline-flex">
        <Zap className="size-3.5 text-amber-500" />
        GPU Acceleration (NVENC / QSV / AMF)
      </span>
      <span className="hidden size-1 rounded-full bg-border sm:inline-block" />
      <span className="hidden items-center gap-1.5 sm:inline-flex">
        <HardDrive className="size-3.5 text-sky-500" />
        Zero Cloud Storage
      </span>
    </div>
  )
}
