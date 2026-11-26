import {
  allTimeRange, arabicMonthName, arabicQuarterName, clampRange, compareDates, formatArabicShort,
  monthRange, parseYearMonth, quarterOfMonth, quarterRange
} from './dates'
import type { DateRange, PeriodKind } from './types'

export interface PeriodState {
  kind: PeriodKind
  day: string // YYYY-MM-DD
  month: string // YYYY-MM
  year: number
  quarter: number // 1..4
}

export function defaultPeriod(today: string, kind: PeriodKind = 'month'): PeriodState {
  const { year, month } = parseYearMonth(today.slice(0, 7))
  return { kind, day: today, month: today.slice(0, 7), year, quarter: quarterOfMonth(month) }
}

export interface ResolvedPeriod {
  range: DateRange | null // null = الفترة خارج مدة المبادرة
  title: string
  note: string
}

/** يحوّل اختيار المستخدم إلى نطاق تواريخ فعلي ضمن [بداية المبادرة، اليوم] مع شرح بالعربية */
export function resolvePeriod(p: PeriodState, campaignStart: string, today: string): ResolvedPeriod {
  if (p.kind === 'all') {
    const r = allTimeRange(campaignStart, today)
    return {
      range: r,
      title: 'منذ بداية المبادرة',
      note: `من ${formatArabicShort(r.from)} حتى ${formatArabicShort(r.to)}`
    }
  }

  if (p.kind === 'day') {
    if (compareDates(p.day, campaignStart) < 0 || compareDates(p.day, today) > 0) {
      return { range: null, title: formatArabicShort(p.day), note: 'هذا اليوم خارج مدة المبادرة' }
    }
    return { range: { from: p.day, to: p.day }, title: formatArabicShort(p.day), note: 'يوم واحد' }
  }

  const { year, month } = p.kind === 'month' ? parseYearMonth(p.month) : { year: p.year, month: 0 }
  const full = p.kind === 'month' ? monthRange(year, month) : quarterRange(p.year, p.quarter)
  const title = p.kind === 'month' ? `${arabicMonthName(month)} ${year}` : `${arabicQuarterName(p.quarter)} ${p.year}`
  const r = clampRange(full, campaignStart, today)
  if (!r) return { range: null, title, note: 'هذه الفترة خارج مدة المبادرة (قبل بدايتها أو لم تأتِ بعد)' }

  const notes = [`من ${formatArabicShort(r.from)} إلى ${formatArabicShort(r.to)}`]
  if (r.to !== full.to) notes.push('الفترة لم تنتهِ بعد، تُحسب حتى اليوم')
  if (r.from !== full.from) notes.push('تبدأ من بداية المبادرة')
  return { range: r, title, note: notes.join(' · ') }
}

export const periodSlug = (p: PeriodState): string =>
  p.kind === 'all' ? 'all' : p.kind === 'day' ? p.day : p.kind === 'month' ? p.month : `${p.year}-Q${p.quarter}`
