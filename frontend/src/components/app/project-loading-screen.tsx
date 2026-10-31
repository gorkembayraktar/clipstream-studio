/** Proje ayarları ve kaynağı geri yüklenirken gösterilen tam ekran durum.
 *
 * Görsel dil oturum splash'ıyla aynıdır: animasyonlu marka, aşama metni ve
 * ilerleme çubuğu (`SplashBody`).
 */
import { SplashBody } from "@/components/app/splash-body"
import { useI18n } from "@/i18n"

interface ProjectLoadingScreenProps {
  phase: "hydrating" | "restoring"
  title: string | null
  progress: number | null
  stage: string | null
  detail: string
}

export function ProjectLoadingScreen({
  phase,
  title,
  progress,
  stage,
  detail,
}: ProjectLoadingScreenProps) {
  const { t } = useI18n()
  const heading =
    phase === "hydrating"
      ? t("project.loadingSettings")
      : t("project.loadingSource")
  const stageLabel =
    phase === "restoring"
      ? stage === "downloading"
        ? t("source.downloadingTiktok")
        : stage === "transcoding"
          ? t("source.preparingBrowser")
          : t("source.resolving")
      : null

  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center overflow-y-auto px-4 py-6 text-foreground">
      <div
        className="w-full min-w-0 max-w-md rounded-2xl border bg-card p-6 text-center shadow-2xl sm:p-8"
        role="status"
        aria-live="polite"
        aria-busy="true"
        data-slot="project-loading-screen"
      >
        <SplashBody
          title={heading}
          subtitle={title ?? undefined}
          caption={
            phase === "hydrating"
              ? t("project.loadingSettingsDetail")
              : stageLabel || t("project.loadingSourceDetail")
          }
          detail={phase === "restoring" ? detail : undefined}
          progress={progress}
          markClassName="h-20 w-auto"
        />
      </div>
    </div>
  )
}
