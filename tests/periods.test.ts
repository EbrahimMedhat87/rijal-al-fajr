import { describe, expect, it } from 'vitest'
import { defaultPeriod, periodSlug, resolvePeriod, type PeriodState } from '../src/lib/periods'
import { formatDateTimeInTz } from '../src/lib/dates'
import { matchesQuery, normalizeArabic } from '../src/lib/text'

const START = '2026-09-10'
const TODAY = '2026-11-26'
const P = (o: Partial<PeriodState>): PeriodState => ({ ...defaultPeriod(TODAY), ...o })

describe('resolvePeriod', () => {
  it('شهر كامل داخل المدة', () => {
    const r = resolvePeriod(P({ kind: 'month', month: '2026-10' }), START, TODAY)
    expect(r.range).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(r.title).toBe('أكتوبر 2026')
  })
  it('الشهر الحالي يُقصّ عند اليوم ويُوضَّح ذلك', () => {
    const r = resolvePeriod(P({ kind: 'month', month: '2026-11' }), START, TODAY)
    expect(r.range).toEqual({ from: '2026-11-01', to: '2026-11-26' })
    expect(r.note).toContain('لم تنتهِ بعد')
  })
  it('شهر البداية يُقصّ من تاريخ بدء المبادرة', () => {
    const r = resolvePeriod(P({ kind: 'month', month: '2026-09' }), START, TODAY)
    expect(r.range).toEqual({ from: '2026-09-10', to: '2026-09-30' })
    expect(r.note).toContain('بداية المبادرة')
  })
  it('شهر قبل البداية أو في المستقبل => range=null', () => {
    expect(resolvePeriod(P({ kind: 'month', month: '2026-08' }), START, TODAY).range).toBeNull()
    expect(resolvePeriod(P({ kind: 'month', month: '2026-12' }), START, TODAY).range).toBeNull()
  })
  it('الربع الرابع 2026 حتى اليوم، والربع الثالث من بداية المبادرة', () => {
    expect(resolvePeriod(P({ kind: 'quarter', year: 2026, quarter: 4 }), START, TODAY).range).toEqual({ from: '2026-10-01', to: '2026-11-26' })
    expect(resolvePeriod(P({ kind: 'quarter', year: 2026, quarter: 3 }), START, TODAY).range).toEqual({ from: '2026-09-10', to: '2026-09-30' })
    expect(resolvePeriod(P({ kind: 'quarter', year: 2026, quarter: 2 }), START, TODAY).range).toBeNull()
  })
  it('عبور حدود السنة: مبادرة بدأت في ديسمبر والربع الأول للسنة التالية', () => {
    const r = resolvePeriod(P({ kind: 'quarter', year: 2027, quarter: 1 }), '2026-12-20', '2027-02-10')
    expect(r.range).toEqual({ from: '2027-01-01', to: '2027-02-10' })
    const dec = resolvePeriod(P({ kind: 'month', month: '2026-12' }), '2026-12-20', '2027-02-10')
    expect(dec.range).toEqual({ from: '2026-12-20', to: '2026-12-31' })
  })
  it('كل الوقت', () => {
    expect(resolvePeriod(P({ kind: 'all' }), START, TODAY).range).toEqual({ from: START, to: TODAY })
  })
  it('يوم واحد', () => {
    expect(resolvePeriod(P({ kind: 'day', day: '2026-11-01' }), START, TODAY).range).toEqual({ from: '2026-11-01', to: '2026-11-01' })
    expect(resolvePeriod(P({ kind: 'day', day: '2026-11-27' }), START, TODAY).range).toBeNull()
    expect(resolvePeriod(P({ kind: 'day', day: '2026-09-09' }), START, TODAY).range).toBeNull()
  })
  it('periodSlug', () => {
    expect(periodSlug(P({ kind: 'month', month: '2026-10' }))).toBe('2026-10')
    expect(periodSlug(P({ kind: 'quarter', year: 2026, quarter: 4 }))).toBe('2026-Q4')
    expect(periodSlug(P({ kind: 'all' }))).toBe('all')
  })
  it('defaultPeriod يلتقط شهر وربع اليوم', () => {
    expect(defaultPeriod('2026-11-26')).toMatchObject({ month: '2026-11', year: 2026, quarter: 4 })
    expect(defaultPeriod('2027-01-02')).toMatchObject({ month: '2027-01', year: 2027, quarter: 1 })
  })
})

describe('formatDateTimeInTz', () => {
  it('يعرض وقت التسجيل بتوقيت القاهرة (4:30 فجرًا)', () => {
    expect(formatDateTimeInTz('2026-12-05T02:30:00Z', 'Africa/Cairo')).toBe('2026-12-05 04:30')
    expect(formatDateTimeInTz('2026-07-01T21:30:00Z', 'Africa/Cairo')).toBe('2026-07-02 00:30')
  })
})

describe('البحث بالعربية', () => {
  it('يتجاهل الهمزات والتشكيل وفروق الياء/الألف المقصورة والتاء المربوطة', () => {
    expect(matchesQuery('أَحْمَد', 'احمد')).toBe(true)
    expect(matchesQuery('إبراهيم', 'ابراهيم')).toBe(true)
    expect(matchesQuery('مصطفى', 'مصطفي')).toBe(true)
    expect(matchesQuery('فاطمة', 'فاطمه')).toBe(true)
    expect(matchesQuery('محمد علي', 'علي')).toBe(true)
    expect(matchesQuery('محمد', 'يوسف')).toBe(false)
    expect(matchesQuery('محمد', '   ')).toBe(true)
    expect(normalizeArabic('٣٢')).toBe('32')
  })
})
