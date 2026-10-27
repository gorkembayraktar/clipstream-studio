/** Düzenleme durumu: segmentler (çoklu kesim), döngü ve kırpma.
 *
 * Segmentler **kaynak zamanında** tutulur: bir segment kaynaktaki
 * `[start, end)` aralığını temsil eder, aradaki boşluklar dışa aktarmadan
 * çıkarılır. Ana çizelge bu segmentleri **çıktı zamanında** (boşluksuz,
 * birleşik) gösterir; dönüşüm `sourceToOutputTime` / `outputToSourceTime` ile
 * yapılır. Segment üzerindeki `speed`/`effects` alanları ileride hız, blur,
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

/**
 * In/Out seçimi bağımsızdır: segmentleri kırpmaz. Geçerli bir seçim yoksa
 * (kaynak yeni yüklendi) segmentlerin penceresine oturtulur.
 */
export function ensureTrim(trim: TimeRange, segments: Segment[]): TimeRange {
  if (trim.end - trim.start >= MIN_TRIM_SECONDS) return trim
  return trimOf(segments)
}

/** In/Out seçimiyle kesişen parçalar (dışa aktarmanın gerçek sınırı). */
export function clippedSegments(segments: Segment[], trim: TimeRange): TimeRange[] {
  if (trim.end - trim.start < 0.001) return []
  const clipped: TimeRange[] = []
  for (const segment of segments) {
    const start = Math.max(segment.start, trim.start)
    const end = Math.min(segment.end, trim.end)
    if (end - start > 0.001) clipped.push({ start, end })
  }
  return clipped
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

/** Bir segmentin çıktı zamanındaki yeri. */
export interface SegmentSpan {
  segment: Segment
  /** Çıktı zamanı başlangıcı (sn). */
  start: number
  /** Çıktı zamanı bitişi (sn). */
  end: number
}

/** Segmentleri boşluk bırakmadan çıktı zamanına dizer. */
export function layoutOf(segments: Segment[]): SegmentSpan[] {
  const spans: SegmentSpan[] = []
  let cursor = 0
  for (const segment of segments) {
    const length = segmentOutputLength(segment)
    spans.push({ segment, start: cursor, end: cursor + length })
    cursor += length
  }
  return spans
}

/** Kaynak zamanını çıktı zamanına çevirir (boşlukta en yakın sınıra düşer). */
export function sourceToOutputTime(segments: Segment[], time: number): number {
  let cursor = 0
  for (const segment of segments) {
    const length = segmentOutputLength(segment)
    if (time < segment.start) return cursor
    if (time <= segment.end) {
      const speed = segment.speed > 0 ? segment.speed : 1
      return cursor + Math.min(length, (time - segment.start) / speed)
    }
    cursor += length
  }
  return cursor
}

/** Çıktı zamanını kaynak zamanına çevirir. */
export function outputToSourceTime(segments: Segment[], time: number): number {
  let cursor = 0
  for (const segment of segments) {
    const length = segmentOutputLength(segment)
    const speed = segment.speed > 0 ? segment.speed : 1
    if (time <= cursor + length) {
      return segment.start + clamp((time - cursor) * speed, 0, segment.end - segment.start)
    }
    cursor += length
  }
  const last = segments[segments.length - 1]
  return last ? last.end : 0
}

/** Verilen zamandaki segment (yoksa null → boşluk). */
export function segmentAt(segments: Segment[], time: number): Segment | null {
  return segments.find((segment) => time >= segment.start && time < segment.end) ?? null
}

/** İki bölme noktası bundan yakınsa tek sayılır (sn). */
const SPLIT_EPSILON = 0.05

/** Bölme noktalarını sıralar, pencereye sığdırır ve tekrarları atar. */
export function normalizeSplits(points: number[], duration: number): number[] {
  const max = duration > 0 ? duration : Number.MAX_SAFE_INTEGER
  const sorted = points
    .map((point) => clamp(roundMs(point), 0, max))
    .filter((point) => point > SPLIT_EPSILON && point < max - SPLIT_EPSILON)
    .sort((a, b) => a - b)
  const result: number[] = []
  for (const point of sorted) {
    const last = result[result.length - 1]
    if (last === undefined || point - last > SPLIT_EPSILON) result.push(point)
  }
  return result
}

/** Yalnızca korunan bir parçanın **içinde** kalan bölmeler tutulur. */
export function pruneSplits(splits: number[], segments: Segment[]): number[] {
  if (splits.length === 0) return splits
  return splits.filter((point) =>
    segments.some(
      (segment) =>
        point > segment.start + SPLIT_EPSILON && point < segment.end - SPLIT_EPSILON,
    ),
  )
}

/**
 * Verilen zamandaki parçanın sınırları.
 *
 * Parça = segment (korunan aralık) içinde kullanıcı bölmeleriyle ayrılmış en
 * küçük birim. Kullanıcı imleçten böldüğünde hiçbir içerik atılmaz; yalnızca
 * yeni bir sınır eklenir ve o parça tek başına silinebilir/dışa aktarılabilir.
 */
export function pieceAt(
  segments: Segment[],
  splits: number[],
  time: number,
): TimeRange | null {
  const segment = segmentAt(segments, time)
  if (!segment) return null
  let start = segment.start
  let end = segment.end
  for (const point of splits) {
    if (point <= segment.start || point >= segment.end) continue
    if (point <= time && point > start) start = point
    if (point > time && point < end) end = point
  }
  return { start, end }
}

interface EditState {
  /** Dışa aktarılacak parçalar (kaynak zamanında, sıralı). */
  segments: Segment[]
  /**
   * Kullanıcı bölme noktaları (kaynak zamanında, kalıcı).
   *
   * Gerçek editördeki makas: imleçten bölmek içerik **atmaz**, yalnızca parçayı
   * ikiye ayırır. Silme ayrı bir eylemdir (`removePieceAt`) ve boşluk bırakır.
   */
  splits: number[]
  /** Giriş/çıkış seçimi (kaynak zamanında, kalıcı). Segmentleri kırpmaz. */
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
  /** Bölme noktalarını kurar (proje geri yükleme). */
  setSplits: (points: number[]) => void
  setSelection: (range: TimeRange | null) => void
  /** İmleçten böler: parçayı ikiye ayırır, içerik atmaz (makas). */
  splitAt: (time: number) => boolean
  /** Verilen zamandaki parçayı siler (boşluk bırakır, geri alınabilir). */
  removePieceAt: (time: number) => boolean
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
  /** Akışa yeni içerik eklendiğinde son segmenti/Out noktasını uzatır. */
  extendToDuration: (from: number, to: number) => void
}

export const useEditStore = create<EditState>()((set, get) => ({
  segments: [],
  splits: [],
  trim: { start: 0, end: 0 },
  selection: null,
  loop: false,

  crop: { enabled: false, rect: null, aspect: "free" },
  sourceDuration: 0,

  setTrim: (partial) =>
    set((state) => {
      // In/Out yalnızca seçimdir: segmentlere dokunmaz, çizelgeyi kaydırmaz.
      const max = state.sourceDuration > 0 ? state.sourceDuration : Number.MAX_SAFE_INTEGER
      let start = state.trim.start
      let end = state.trim.end
      if (partial.start !== undefined) {
        start = clamp(roundMs(partial.start), 0, Math.max(0, end - MIN_TRIM_SECONDS))
      }
      if (partial.end !== undefined) {
        end = clamp(roundMs(partial.end), start + MIN_TRIM_SECONDS, max)
      }
      if (end - start < MIN_TRIM_SECONDS) return {}
      return { trim: { start, end } }
    }),

  setSegments: (ranges) =>
    set((state) => {
      const segments = normalizeSegments(
        ranges.map((range) => createSegment(range.start, range.end)),
        state.sourceDuration,
      )
      return {
        segments,
        splits: pruneSplits(
          normalizeSplits(state.splits, state.sourceDuration),
          segments,
        ),
        trim: ensureTrim(state.trim, segments),
        selection: null,
      }
    }),

  setSplits: (points) =>
    set((state) => ({
      splits: pruneSplits(
        normalizeSplits(points, state.sourceDuration),
        state.segments,
      ),
    })),

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

  splitAt: (time) => {
    const state = get()
    const at = roundMs(time)
    const piece = pieceAt(state.segments, state.splits, at)
    // Boşlukta, sınırın üzerinde veya çok yakınında bölme anlamsız.
    if (!piece) return false
    if (at <= piece.start + SPLIT_EPSILON || at >= piece.end - SPLIT_EPSILON) {
      return false
    }
    set({
      splits: normalizeSplits([...state.splits, at], state.sourceDuration),
      selection: null,
    })
    return true
  },

  removePieceAt: (time) => {
    const state = get()
    const piece = pieceAt(state.segments, state.splits, time)
    if (!piece) return false
    if (piece.end - piece.start < MIN_TRIM_SECONDS) return false
    const segments = cutRange(
      state.segments,
      piece.start,
      piece.end,
      state.sourceDuration,
    )
    const splits = pruneSplits(
      state.splits.filter(
        (point) =>
          point < piece.start - SPLIT_EPSILON || point > piece.end + SPLIT_EPSILON,
      ),
      segments,
    )
    set({
      segments,
      splits,
      trim: ensureTrim(state.trim, segments),
      selection: null,
    })
    return true
  },

  removeSelection: () =>
    set((state) => {
      if (!state.selection) return {}
      const { start, end } = state.selection
      const next = cutRange(state.segments, start, end, state.sourceDuration)
      return {
        segments: next,
        splits: pruneSplits(state.splits, next),
        trim: ensureTrim(state.trim, next),
        selection: null,
      }
    }),

  removeRange: (range) =>
    set((state) => {
      const start = Math.min(range.start, range.end)
      const end = Math.max(range.start, range.end)
      if (end - start < MIN_TRIM_SECONDS) return {}
      const next = cutRange(state.segments, start, end, state.sourceDuration)
      return {
        segments: next,
        splits: pruneSplits(state.splits, next),
        trim: ensureTrim(state.trim, next),
        selection: null,
      }
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
      return {
        segments: next,
        splits: pruneSplits(state.splits, next),
        trim: ensureTrim(state.trim, next),
        selection: null,
      }
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
      return {
        segments: normalized,
        splits: pruneSplits(state.splits, normalized),
        trim: ensureTrim(state.trim, normalized),
      }
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
      // Seçim de pencereyle birlikte kayar; geçersizse segmentlere oturtulur.
      const trim = {
        start: clamp(state.trim.start + clamped, 0, max),
        end: clamp(state.trim.end + clamped, 0, max),
      }
      const splits = pruneSplits(
        normalizeSplits(
          state.splits.map((point) => point + clamped),
          duration,
        ),
        segments,
      )
      return { segments, splits, trim: ensureTrim(trim, segments) }
    }),

  resetSegments: () =>
    set((state) => {
      const duration = state.sourceDuration
      const next = duration > 0 ? [createSegment(0, duration)] : []
      return {
        segments: next,
        splits: [],
        trim: ensureTrim(state.trim, next),
        selection: null,
      }
    }),
  setLoop: (value) => set({ loop: value }),

  setCropEnabled: (value) =>
    set((state) => ({ crop: { ...state.crop, enabled: value } })),
  setCropRect: (rect) => set((state) => ({ crop: { ...state.crop, rect } })),
  setCropAspect: (aspect) => set((state) => ({ crop: { ...state.crop, aspect } })),

  resetEdit: () =>
    set({
      segments: [],
      splits: [],
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
      // In/Out seçimi korunur, yalnızca kaynak süresine sığdırılır.
      const max = sourceDuration > 0 ? sourceDuration : Number.MAX_SAFE_INTEGER
      const trim = ensureTrim(
        {
          start: clamp(state.trim.start, 0, max),
          end: clamp(state.trim.end, 0, max),
        },
        segments,
      )
      return {
        sourceDuration,
        segments,
        splits: pruneSplits(
          normalizeSplits(state.splits, sourceDuration),
          segments,
        ),
        trim,
      }
    }),

  /**
   * Akışa yeni kayıt eklendiğinde çizelgeyi uzatır.
   *
   * Son segment akışın sonuna dayanıyorsa uzatılır. Kullanıcı kuyruğu
   * kesmişse yeni kayıt kesiğin ardına ayrı segment olarak eklenir: kesim
   * korunur ama yeni içerik görünür ve dışa aktarılabilir kalır.
   */
  extendToDuration: (from, to) =>
    set((state) => {
      if (from <= 0 || to <= from) return {}
      const segments = [...state.segments]
      if (segments.length === 0) {
        segments.push(createSegment(0, to))
      } else {
        const last = segments[segments.length - 1]
        if (Math.abs(last.end - from) <= 0.05) {
          segments[segments.length - 1] = { ...last, end: to }
        } else {
          segments.push(createSegment(from, to))
        }
      }
      // Out noktası yeni içeriği kapsar; neyin kesildiğini segmentler belirler.
      const trim = { ...state.trim, end: Math.max(state.trim.end, to) }
      return { segments, trim }
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
