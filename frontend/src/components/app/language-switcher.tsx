import { LanguagesIcon } from "lucide-react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { LOCALE_OPTIONS, useI18n, type Locale } from "@/i18n"

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n()

  return (
    <div className="flex items-center gap-1.5">
      <LanguagesIcon className="size-3.5 text-muted-foreground" aria-hidden />
      <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
        <SelectTrigger
          size="sm"
          className="h-6 w-[104px] text-[11px]"
          aria-label={t("language.switch")}
          title={t("language.switch")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="end" className="min-w-[120px]">
          {LOCALE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value} className="text-xs">
              {t(option.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
