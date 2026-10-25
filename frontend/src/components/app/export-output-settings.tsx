import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useI18n } from "@/i18n"
import type { OutputFormat } from "@/lib/types"

import { FieldLabel } from "./export-controls"
import {
  FORMAT_LABELS,
  FORMAT_NOTE_KEYS,
  PROFILE_LABEL_KEYS,
  QUALITY_DESCRIPTION_KEYS,
  type ExportProfile,
} from "./export-panel-constants"

interface ExportOutputSettingsProps {
  outputFormat: OutputFormat
  onOutputFormatChange: (format: OutputFormat) => void
  profile: ExportProfile
  onProfileChange: (profile: string) => void
  originalAvailable: boolean
  originalBlockers: string[]
  filename: string
  onFilenameChange: (value: string) => void
  onResetFilename: () => void
}

const FORMATS: OutputFormat[] = ["mp4", "gif", "mp3"]

export function ExportOutputSettings({
  outputFormat,
  onOutputFormatChange,
  profile,
  onProfileChange,
  originalAvailable,
  originalBlockers,
  filename,
  onFilenameChange,
  onResetFilename,
}: ExportOutputSettingsProps) {
  const { t } = useI18n()
  const formatNote = t(FORMAT_NOTE_KEYS[outputFormat])
  const profileInfo =
    profile === "original"
      ? t("export.qualityOriginalDescription")
      : `${t(QUALITY_DESCRIPTION_KEYS[profile])} ${t("export.qualitySavingsNote")}`
  const profileDescriptionId =
    outputFormat === "mp4" ? "export-profile-description" : undefined
  const filenameHasExtension = filename
    .trim()
    .toLowerCase()
    .endsWith(`.${outputFormat}`)

  return (
    <section className="space-y-3 border-b border-border/60 p-3">
      <h3 className="text-xs font-semibold">{t("export.output")}</h3>

      <div
        className={cn(
          "grid gap-2",
          outputFormat === "mp4" ? "grid-cols-2" : "grid-cols-1",
        )}
      >
        <div className="min-w-0 space-y-1.5">
          <FieldLabel
            htmlFor="export-format"
            label={t("export.outputFormat")}
          />
          <Select
            value={outputFormat}
            onValueChange={(value) =>
              onOutputFormatChange(value as OutputFormat)
            }
          >
            <SelectTrigger id="export-format" className="h-9 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORMATS.map((format) => (
                <SelectItem key={format} value={format} className="text-xs">
                  {FORMAT_LABELS[format]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {outputFormat === "mp4" ? (
          <div className="min-w-0 space-y-1.5">
            <FieldLabel
              htmlFor="export-profile"
              label={t("export.profile")}
              hint={profileInfo}
              hintLabel={t("export.fieldInfo", { field: t("export.profile") })}
            />
            <Select value={profile} onValueChange={onProfileChange}>
              <SelectTrigger
                id="export-profile"
                className="h-9 w-full text-xs"
                aria-describedby={profileDescriptionId}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  value="original"
                  className="text-xs"
                  disabled={!originalAvailable}
                >
                  {t(PROFILE_LABEL_KEYS.original)}
                </SelectItem>
                {(Object.keys(PROFILE_LABEL_KEYS) as ExportProfile[])
                  .filter((value) => value !== "original")
                  .map((value) => (
                    <SelectItem key={value} value={value} className="text-xs">
                      {t(PROFILE_LABEL_KEYS[value])}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {outputFormat === "mp4" ? (
        <p
          id={profileDescriptionId}
          className={cn(
            "text-[10px] leading-snug",
            originalAvailable
              ? "text-muted-foreground"
              : "text-amber-600 dark:text-amber-400",
          )}
        >
          {originalAvailable
            ? t("export.profileHelper")
            : t("export.profileBlocked", {
                reasons: originalBlockers.join(", "),
              })}
        </p>
      ) : null}

      <p className="text-[10px] leading-snug text-muted-foreground">
        {formatNote}
      </p>

      <div className="space-y-1.5">
        <FieldLabel htmlFor="export-filename" label={t("export.filename")} />
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Input
              id="export-filename"
              className={cn(
                "h-9 text-xs",
                !filenameHasExtension && "pr-11",
              )}
              placeholder={t("export.filenamePlaceholder")}
              value={filename}
              onChange={(event) => onFilenameChange(event.target.value)}
            />
            {!filenameHasExtension ? (
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] text-muted-foreground">
                .{outputFormat}
              </span>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 shrink-0 px-2 text-[11px]"
            onClick={onResetFilename}
            disabled={!filename.trim()}
            title={t("export.filenameAuto")}
          >
            {t("export.filenameAuto")}
          </Button>
        </div>
      </div>
    </section>
  )
}
