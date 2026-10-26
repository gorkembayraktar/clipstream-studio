/** Düzenleme durumu: segmentler (çoklu kesim), döngü ve kırpma.
 *
 * Zaman çizelgesi **kaynak zamanında** kalır: bir segment kaynaktaki
 * `[start, end)` aralığını temsil eder, aradaki boşluklar dışa aktarmadan
 * çıkarılır. Segment üzerindeki `speed`/`effects` alanları ileride hız, blur,
 * filigran gibi işlemler için ayrılmıştır; dışa aktarma her segmenti ayrı
 * işleyip birleştirdiği için bu alanlar migration gerektirmeden eklenebilir.
 */
import { create } from "zustand"

import { clamp } from "@/lib/format"
import type { AspectPreset, CropRect } from "@/lib/types"

const roundMs = (value: number) => Math.round(value * 1000) / 1000

/** En kısa segment süresi (sn). */
export const MIN_TRIM_SECONDS = 0.05

/** Bu mesafeden yakın segmentler birleştirilir (sn). */
const SEGMENT_MERGE_EPSILON = 0.02

let segmentSequence = 0

function nextSegmentId(): string {
  segmentSequence += 1
  return `seg_${Date.now().toString(36)}_${segmentSequence}`
}

export interface TimeRange {
  start: number
  end: number
}

/** Segment üzerinde dışa aktarmada uygulanacak işlem (ileride: blur, filigran…). */
export interface SegmentEffect {
  id: string
  type: string
  params: Record<string, number | string | boolean>
}

export interface Segment {
  id: string
  /** Kaynak zamanı (sn). */
  start: number
  end: number
  /** Hız çarpanı (1 = normal). Çıktı süresini etkiler, çizelge kaynak zamanında kalır. */
  speed: number
  /** Segment bazlı işlemler. Bugün yalnızca taşınır, henüz uygulanmıyor. */
  effects: SegmentEffect[]
}

export function createSegment(start: number, end: number): Segment {
  return { id: nextSegmentId(), start, end, speed: 1, effects: [] }
}

/** İki segment birleştirilebilir mi? Hız/işlem farkı varsa ayrı kalmalı. */
function sameTreatment(a: Segment, b: Segment): boolean {
  return a.speed === b.speed && a.effects.length === 0 && b.effects.length === 0
}

/** Sıralar, kırpar, çok kısa parçaları atar ve (isteğe bağlı) değenleri birleştirir. */
function normalizeSegments(
  segments: Segment[],
  duration: number,
  merge = true,
): Segment[] {
  const max = duration > 0 ? duration : Number.MAX_SAFE_INTEGER
  const cleaned = segments
    .map((segment) => ({
      ...segment,
      start: clamp(roundMs(segment.start), 0, max),
      end: clamp(roundMs(segment.end), 0, max),
    }))
    .filter((segment) => segment.end - segment.start >= MIN_TRIM_SECONDS)
    .sort((a, b) => a.start - b.start)

  const merged: Segment[] = []
  for (const segment of cleaned) {
    const last = merged[merged.length - 1]
    if (
      merge &&
      last &&
      segment.start <= last.end + SEGMENT_MERGE_EPSILON &&
      sameTreatment(last, segment)
    ) {
      last.end = Math.max(last.end, segment.end)
    } else {
      merged.push({ ...segment, effects: [...segment.effects] })
    }
  }
  return merged
}

/** Segmentlerin kapsadığı pencere (giriş/çıkış). */
export function trimOf(segments: Segment[]): TimeRange {
  if (segments.length === 0) return { start: 0, end: 0 }
  return {
    start: segments[0].start,
    end: segments[segments.length - 1].end,
  }
}

/** Segmentler arasındaki boşluklar (dışa aktarmadan çıkarılan aralıklar). */
export function gapsOf(segments: Segment[], window: TimeRange): TimeRange[] {
  if (window.end <= window.start) return []
  const gaps: TimeRange[] = []
  let cursor = window.start
  for (const segment of segments) {
    if (segment.start > cursor) {
      gaps.push({ start: cursor, end: Math.min(segment.start, window.end) })
    }
    cursor = Math.max(cursor, segment.end)
  }
  if (cursor < window.end) gaps.push({ start: cursor, end: window.end })
  return gaps.filter((gap) => gap.end - gap.start > 0.0005)
}

/** Segmentlerin toplam kaynak süresi (sn). */
export function keptDuration(segments: Segment[]): number {
  return segments.reduce(
    (total, segment) => total + Math.max(0, segment.end - segment.start),
    0,
  )
}

/** Bir segmentin çıktı süresi (hız uygulanmış). */
function segmentOutputLength(segment: Segment): number {
  const speed = segment.speed > 0 ? segment.speed : 1
  return Math.max(0, segment.end - segment.start) / speed
}

/** Segmentlerin hız uygulanmış çıktı süresi (sn). */
export function outputDuration(segments: Segment[]): number {
  return segments.reduce((total, segment) => total + segmentOutputLength(segment), 0)
}

/**
 * Kaynak zamanını çıktı zamanına çevirir (boşluklar sıkıştırılır).
 *
 * Boşluk içindeki bir zaman, o boşluktan sonraki segmentin çıktıdaki başına
 * eşlenir; böylece imleç kesim sınırında durur, ışınlanmış gibi görünmez.
 */
export function sourceToOutputTime(segments: Segment[], time: number): number {
  let output = 0
  for (const segment of segments) {
    if (time < segment.start) return output
    if (time < segment.end) {
      const speed = segment.speed > 0 ? segment.speed : 1
      return output + (time - segment.start) / speed
    }
    output += segmentOutputLength(segment)
  }
  return output
}

/** Çıktı zamanını kaynak zamanına çevirir (çıktı çizelgesinde tıklama/sarma). */
export function outputToSourceTime(segments: Segment[], time: number): number {
  if (segments.length === 0) return 0
  let output = 0
  for (const segment of segments) {
    const length = segmentOutputLength(segment)
    if (time < output + length) {
      const speed = segment.speed > 0 ? segment.speed : 1
      return segment.start + (time - output) * speed
    }
    output += length
  }
  return segments[segments.length - 1].end
}

/** Segmentlerin çıktıdaki yerleşimi: [başlangıç, bitiş) çıktı saniyesi. */
export function outputLayout(
  segments: Segment[],
): Array<{ segment: Segment; start: number; end: number }> {
  let offset = 0
  return segments.map((segment) => {
    const length = segmentOutputLength(segment)
    const entry = { segment, start: offset, end: offset + length }
    offset += length
    return entry
  })
}

/** Verilen zamandaki segment (yoksa null → boşluk). */
export function segmentAt(segments: Segment[], time: number): Segment | null {
  return segments.find((segment) => time >= segment.start && time < segment.end) ?? null
}

interface EditState {
  /** Dışa aktarılacak parçalar (kaynak zamanında, sıralı). */
  segments: Segment[]
  /** Giriş/çıkış: ilk segmentin başı ve son segmentin sonu (türetilmiş). */
  trim: TimeRange
  /** Zaman çizelgesinde seçilen aralık (kesmek için; kalıcı değil). */
  selection: TimeRange | null
  loop: boolean

  // Kırpma
  crop: { enabled: boolean; rect: CropRect | null; aspect: AspectPreset }

  /**
   * Kaynak süresi (sn). Segmentleri sınırlamak için `setMeta` ile
   * senkronlanır; kaynak sıfırlandığında 0'a döner.
   */
  sourceDuration: number

  // Eylemler
  setTrim: (partial: Partial<TimeRange>) => void
  /** Segment listesini doğrudan kurar (proje geri yükleme). */
  setSegments: (ranges: TimeRange[]) => void
  setSelection: (range: TimeRange | null) => void
  /** Seçili aralığı segmentlerden çıkarır (böl + at). */
  removeSelection: () => void
  removeRange: (range: TimeRange) => void
  /** Çıkarılmış bir aralığı geri ekler (komşularla birleşir). */
  restoreRange: (range: TimeRange) => void
  /** Segment kenarını sürükler; komşuya değerse boşluk kapanır. */
  updateSegmentEdge: (id: string, edge: "start" | "end", time: number) => void
  /** Tüm segmentleri birlikte kaydırır (pencereyi taşımak); boşluklar korunur. */
  shiftSegments: (delta: number) => void
  /** Tüm kesimleri geri alır: tek segment [0, süre]. */
  resetSegments: () => void
  setLoop: (value: boolean) => void
  setCropEnabled: (value: boolean) => void
  setCropRect: (rect: CropRect | null) => void
  setCropAspect: (aspect: AspectPreset) => void
  /** Kesim ve kırpmayı başlangıç değerlerine döndürür (kaynak değiştiğinde). */
  resetEdit: () => void
  /** Segmentleri kaynak süresine sığdırır (meta güncellendiğinde). */
  clampTrimToDuration: (duration: number) => void
}

export const useEditStore = create<EditState>()((set) => ({
  segments: [],
  trim: { start: 0, end: 0 },
  selection: null,
  loop: false,

  crop: { enabled: false, rect: null, aspect: "free" },
  sourceDuration: 0,

  setTrim: (partial) =>
    set((state) => {
      const duration = state.sourceDuration
      const max = duration > 0 ? duration : Number.MAX_SAFE_INTEGER
      const segments =
        state.segments.length > 0
          ? state.segments.map((segment) => ({ ...segment, effects: [...segment.effects] }))
          : [createSegment(0, duration)]

      if (partial.start !== undefined && segments.length > 0) {
        const first = segments[0]
        first.start = clamp(
          roundMs(partial.start),
          0,
          Math.max(0, first.end - MIN_TRIM_SECONDS),
        )
      }
      if (partial.end !== undefined && segments.length > 0) {
        const last = segments[segments.length - 1]
        last.end = clamp(
          roundMs(partial.end),
          Math.min(max, last.start + MIN_TRIM_SECONDS),
          max,
        )
      }

      const next = normalizeSegments(segments, duration)
      return { segments: next, trim: trimOf(next) }
    }),

  setSegments: (ranges) =>
    set((state) => {
      const segments = normalizeSegments(
        ranges.map((range) => createSegment(range.start, range.end)),
        state.sourceDuration,
      )
      return { segments, trim: trimOf(segments), selection: null }
    }),

  setSelection: (range) =>
    set((state) => {
      if (!range) return { selection: null }
      const max =
        state.sourceDuration > 0 ? state.sourceDuration : Number.MAX_SAFE_INTEGER
      const start = clamp(roundMs(Math.min(range.start, range.end)), 0, max)
      const end = clamp(roundMs(Math.max(range.start, range.end)), 0, max)
      // Çok kısa seçim kesim sayılmaz: yanlışlıkla tıklamada bant oluşmasın.
      if (end - start < MIN_TRIM_SECONDS) return { selection: null }
      return { selection: { start, end } }
    }),

  removeSelection: () =>
    set((state) => {
      if (!state.selection) return {}
      const { start, end } = state.selection
      const next = cutRange(state.segments, start, end, state.sourceDuration)
      return { segments: next, trim: trimOf(next), selection: null }
    }),

  removeRange: (range) =>
    set((state) => {
      const start = Math.min(range.start, range.end)
      const end = Math.max(range.start, range.end)
      if (end - start < MIN_TRIM_SECONDS) return {}
      const next = cutRange(state.segments, start, end, state.sourceDuration)
      return { segments: next, trim: trimOf(next), selection: null }
    }),

  restoreRange: (range) =>
    set((state) => {
      const start = Math.min(range.start, range.end)
      const end = Math.max(range.start, range.end)
      if (end - start < MIN_TRIM_SECONDS) return {}
      const next = normalizeSegments(
        [...state.segments, createSegment(start, end)],
        state.sourceDuration,
      )
      return { segments: next, trim: trimOf(next), selection: null }
    }),

  updateSegmentEdge: (id, edge, time) =>
    set((state) => {
      const index = state.segments.findIndex((segment) => segment.id === id)
      if (index < 0) return {}
      const max =
        state.sourceDuration > 0 ? state.sourceDuration : Number.MAX_SAFE_INTEGER
      const previous = state.segments[index - 1]
      const next = state.segments[index + 1]

      const segments = state.segments.map((segment, position) => {
        if (position !== index) return segment
        if (edge === "start") {
          // Komşunun sonundan öteye gitmez: iki segment üst üste binmez.
          const lower = previous ? previous.end : 0
          return {
            ...segment,
            start: clamp(
              roundMs(time),
              lower,
              Math.max(lower, segment.end - MIN_TRIM_SECONDS),
            ),
          }
        }
        const upper = next ? next.start : max
        return {
          ...segment,
          end: clamp(
            roundMs(time),
            Math.min(upper, segment.start + MIN_TRIM_SECONDS),
            upper,
          ),
        }
      })
      // Sürükleme sırasında birleştirme yapılmaz: kenar komşuya dayandığında
      // segment kaybolmasın, sürükleme aynı kimlikle devam etsin.
      const normalized = normalizeSegments(segments, state.sourceDuration, false)
      return { segments: normalized, trim: trimOf(normalized) }
    }),

  shiftSegments: (delta) =>
    set((state) => {
      if (!Number.isFinite(delta) || state.segments.length === 0) return {}
      const duration = state.sourceDuration
      const max = duration > 0 ? duration : Number.MAX_SAFE_INTEGER
      const first = state.segments[0]
      const last = state.segments[state.segments.length - 1]
      // Pencere [0, süre] içinde kalsın.
      const clamped = clamp(delta, -first.start, Math.max(-first.start, max - last.end))
      if (Math.abs(clamped) < 0.0005) return {}
      const segments = state.segments.map((segment) => ({
        ...segment,
        start: segment.start + clamped,
        end: segment.end + clamped,
      }))
      return { segments, trim: trimOf(segments) }
    }),

  resetSegments: () =>
    set((state) => {
      const duration = state.sourceDuration
      const next = duration > 0 ? [createSegment(0, duration)] : []
      return { segments: next, trim: trimOf(next), selection: null }
    }),
  setLoop: (value) => set({ loop: value }),

  setCropEnabled: (value) =>
    set((state) => ({ crop: { ...state.crop, enabled: value } })),
  setCropRect: (rect) => set((state) => ({ crop: { ...state.crop, rect } })),
  setCropAspect: (aspect) => set((state) => ({ crop: { ...state.crop, aspect } })),

  resetEdit: () =>
    set({
      segments: [],
      trim: { start: 0, end: 0 },
      selection: null,
      crop: { enabled: false, rect: null, aspect: "free" },
      sourceDuration: 0,
    }),

  clampTrimToDuration: (duration) =>
    set((state) => {
      const sourceDuration = duration > 0 ? duration : 0
      let segments =
        state.segments.length > 0
          ? state.segments
          : sourceDuration > 0
            ? [createSegment(0, sourceDuration)]
            : []
      segments = normalizeSegments(segments, sourceDuration)
      if (segments.length === 0 && sourceDuration > 0) {
        segments = [createSegment(0, sourceDuration)]
      }
      return { sourceDuration, segments, trim: trimOf(segments) }
    }),
}))

/** Bir aralığı segment listesinden çıkarır (gerekirse segmenti ikiye böler). */
function cutRange(
  segments: Segment[],
  start: number,
  end: number,
  duration: number,
): Segment[] {
  const next: Segment[] = []
  for (const segment of segments) {
    if (end <= segment.start || start >= segment.end) {
      next.push(segment)
      continue
    }
    if (start > segment.start) {
      next.push({
        ...segment,
        effects: [...segment.effects],
        end: start,
      })
    }
    if (end < segment.end) {
      next.push({
        ...segment,
        id: nextSegmentId(),
        effects: [...segment.effects],
        start: end,
      })
    }
  }
  const normalized = normalizeSegments(next, duration)
  // Son segment kalmadıysa boş liste geçerlidir: arayüz "dışa aktarılacak
  // içerik yok" uyarısı gösterir ve kullanıcı kesimleri geri alabilir.
  return normalized
}
