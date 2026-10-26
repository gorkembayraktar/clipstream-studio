/** Dalga formu çizimi için ortak sabitler ve yardımcılar.
 *
 * Hem düzenlenebilir çizelge (`timeline`) hem de kaynak şeridi
 * (`source-timeline`) aynı çubuk ölçülerini kullanır.
 */

/** Çubuk genişliği ve komşusuyla arası (px). */
export const BAR_WIDTH = 2
export const BAR_GAP = 1
/** Çubukların en küçük yüksekliği (sessiz bölümler de görünür kalsın). */
export const MIN_BAR_HEIGHT = 1
/** Sabit gri (muted-foreground okunamazsa yedek). */
export const FALLBACK_WAVEFORM_COLOR = "#a1a1aa"
/** Çubuk saydamlığı — dalga formu arka planda kalsın, göz yormasın. */
export const WAVEFORM_ALPHA = 0.45
/** Yüksek yakınlaştırmada canvas boyutunu tarayıcı sınırlarında tutar. */
export const MAX_CANVAS_WIDTH = 16384

/** Çıktı zamanındaki bir parçanın kaynak zamanı karşılığı (kesimler atlanır). */
export interface WaveformSpan {
  /** Çıktı zamanı aralığı (sn). */
  start: number
  end: number
  /** Kaynak zamanı aralığı (sn). */
  sourceStart: number
  sourceEnd: number
  /** Hız çarpanı (1 = normal). */
  speed: number
}

/** Canvas'ın anlayacağı bir renk mi? (color-mix gibi değerler çizilemez) */
export function isDrawableColor(value: string): boolean {
  return /^(#|rgb|hsl|oklch|lab|lch|color\()/i.test(value.trim())
}

/** Elementin metin rengini canvas için güvenli bir değere indirger. */
export function waveformColor(element: HTMLElement | null): string {
  const computed = element ? getComputedStyle(element).color : ""
  return isDrawableColor(computed) ? computed : FALLBACK_WAVEFORM_COLOR
}
