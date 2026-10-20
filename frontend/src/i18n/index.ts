/**
 * Tiny, dependency-free i18n layer.
 *
 * The app is a local single-user tool; a typed dictionary keeps the bundle
 * small and makes missing translations a compile-time error. Components use
 * `useI18n()` so they re-render when the language changes. Non-React modules
 * (toasts, logs, formatters) can call `translate()` directly.
 */
import { useCallback } from "react"
import { create } from "zustand"

import { en, type TranslationKey } from "./en"
import { tr } from "./tr"

export type Locale = "en" | "tr"
export type TranslationParams = Record<string, string | number>

export const LOCALE_OPTIONS: { value: Locale; labelKey: TranslationKey }[] = [
  { value: "en", labelKey: "language.en" },
  { value: "tr", labelKey: "language.tr" },
]

const STORAGE_KEY = "clipstream.locale"
const dictionaries: Record<Locale, Record<TranslationKey, string>> = { en, tr }

function isLocale(value: string | null): value is Locale {
  return value === "en" || value === "tr"
}

function detectLocale(): Locale {
  if (typeof window === "undefined") return "en"
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isLocale(stored)) return stored
  } catch {
    /* private mode etc. — fall back to the browser language */
  }

  const language =
    navigator.language || (navigator.languages && navigator.languages[0]) || "en"
  return language.toLowerCase().startsWith("tr") ? "tr" : "en"
}

interface LocaleState {
  locale: Locale
  setLocale: (locale: Locale) => void
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: detectLocale(),
  setLocale: (locale) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, locale)
    } catch {
      /* persistence is best-effort */
    }
    if (typeof document !== "undefined") document.documentElement.lang = locale
    set({ locale })
  },
}))

if (typeof document !== "undefined") {
  document.documentElement.lang = useLocaleStore.getState().locale
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}

/** Translate from React or plain modules. */
export function translate(
  key: TranslationKey,
  params?: TranslationParams,
  locale: Locale = useLocaleStore.getState().locale,
): string {
  return interpolate(dictionaries[locale][key] ?? en[key] ?? key, params)
}

export function getLocale(): Locale {
  return useLocaleStore.getState().locale
}

export function useI18n() {
  const locale = useLocaleStore((state) => state.locale)
  const setLocale = useLocaleStore((state) => state.setLocale)
  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) => translate(key, params, locale),
    [locale],
  )
  return { locale, setLocale, t }
}

export type { TranslationKey }
