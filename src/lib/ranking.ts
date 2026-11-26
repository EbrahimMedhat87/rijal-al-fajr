import type { RankedRow } from './types'

export interface CountRow {
  participantId: string
  name: string
  active: boolean
  days: number
  mosqueName?: string
}

const collator = new Intl.Collator('ar', { sensitivity: 'base', numeric: true })

/**
 * ترتيب تنافسي (competition ranking): 1، 1، 3 …
 *  - الترتيب بعدد أيام الحضور الصالحة تنازليًا، ثم الاسم أبجديًا (للثبات فقط، لا يؤثر على الرتبة).
 *  - من لا حضور له في الفترة يظهر آخر القائمة برتبة null (غير مُرتَّب)، حتى لا يتساوى الجميع في المركز الأول.
 */
export function rankParticipants(rows: CountRow[]): RankedRow[] {
  const sorted = [...rows].sort((a, b) => b.days - a.days || collator.compare(a.name, b.name))
  const out: RankedRow[] = []
  let prevDays: number | null = null
  let prevRank = 0
  sorted.forEach((r, i) => {
    if (r.days <= 0) {
      out.push({ ...r, rank: null })
      return
    }
    const rank = prevDays !== null && r.days === prevDays ? prevRank : i + 1
    prevDays = r.days
    prevRank = rank
    out.push({ ...r, rank })
  })
  return out
}

export function totalDays(rows: { days: number }[]): number {
  return rows.reduce((s, r) => s + r.days, 0)
}

export interface MosqueScoreRow {
  mosqueId: string
  name: string
  children: number // الأطفال النشطون (أو من حضر في الفترة)
  present: number // من حضر مرة على الأقل
  totalDays: number
  avgDays: number // متوسط أيام الحضور للطفل الواحد
}
export interface RankedMosque extends MosqueScoreRow {
  rank: number | null
}

/**
 * ترتيب المساجد بمتوسط أيام الحضور للطفل (عدالة بين مسجد كبير وصغير)، بترتيب تنافسي (1، 1، 3).
 * التعادل يُقاس على المتوسط مقرَّبًا لخانتين؛ ومسجد بلا أي حضور في الفترة لا يُرتَّب.
 */
export function rankMosques(rows: MosqueScoreRow[]): RankedMosque[] {
  const key = (r: MosqueScoreRow) => Math.round(r.avgDays * 100)
  const sorted = [...rows].sort((a, b) => key(b) - key(a) || collator.compare(a.name, b.name))
  const out: RankedMosque[] = []
  let prevKey: number | null = null
  let prevRank = 0
  sorted.forEach((r, i) => {
    if (r.totalDays <= 0) {
      out.push({ ...r, rank: null })
      return
    }
    const k = key(r)
    const rank = prevKey !== null && k === prevKey ? prevRank : i + 1
    prevKey = k
    prevRank = rank
    out.push({ ...r, rank })
  })
  return out
}
