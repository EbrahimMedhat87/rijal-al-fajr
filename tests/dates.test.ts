import { describe, expect, it } from 'vitest'
import {
  addDays, allTimeRange, clampRange, compareDates, daysBetweenInclusive, daysInMonth,
  isValidDateStr, monthRange, quarterOfMonth, quarterRange, todayInTz
} from '../src/lib/dates'

describe('todayInTz (Africa/Cairo)', () => {
  it('الشتاء UTC+2: 22:30 UTC يعني اليوم التالي في القاهرة', () => {
    expect(todayInTz('Africa/Cairo', new Date('2026-11-25T22:30:00Z'))).toBe('2026-11-26')
    expect(todayInTz('Africa/Cairo', new Date('2026-11-25T21:59:59Z'))).toBe('2026-11-25')
    expect(todayInTz('Africa/Cairo', new Date('2026-11-25T22:00:00Z'))).toBe('2026-11-26')
  })
  it('الصيف UTC+3 (توقيت صيفي): 21:00 UTC يعني اليوم التالي', () => {
    expect(todayInTz('Africa/Cairo', new Date('2026-07-01T20:59:59Z'))).toBe('2026-07-01')
    expect(todayInTz('Africa/Cairo', new Date('2026-07-01T21:00:00Z'))).toBe('2026-07-02')
  })
  it('وقت الفجر (4:30 صباحًا بتوقيت القاهرة) ما زال في نفس اليوم مهما كان توقيت الجهاز', () => {
    // 04:30 Cairo شتاء = 02:30 UTC
    expect(todayInTz('Africa/Cairo', new Date('2026-12-05T02:30:00Z'))).toBe('2026-12-05')
  })
  it('حدود السنة', () => {
    expect(todayInTz('Africa/Cairo', new Date('2025-12-31T22:00:00Z'))).toBe('2026-01-01')
  })
})

describe('الحسابات الأساسية للتواريخ', () => {
  it('isValidDateStr', () => {
    expect(isValidDateStr('2026-02-28')).toBe(true)
    expect(isValidDateStr('2026-02-29')).toBe(false)
    expect(isValidDateStr('2028-02-29')).toBe(true)
    expect(isValidDateStr('2026-13-01')).toBe(false)
    expect(isValidDateStr('26-1-1')).toBe(false)
  })
  it('addDays عبر الشهور والسنين', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
  })
  it('compareDates', () => {
    expect(compareDates('2026-01-01', '2026-01-02')).toBe(-1)
    expect(compareDates('2026-01-02', '2026-01-02')).toBe(0)
    expect(compareDates('2026-12-31', '2026-02-01')).toBe(1)
  })
  it('daysInMonth', () => {
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2026, 12)).toBe(31)
    expect(daysInMonth(2026, 4)).toBe(30)
  })
})

describe('نطاقات الفترات', () => {
  it('الشهر', () => {
    expect(monthRange(2026, 1)).toEqual({ from: '2026-01-01', to: '2026-01-31' })
    expect(monthRange(2026, 2)).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthRange(2028, 2)).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(monthRange(2026, 12)).toEqual({ from: '2026-12-01', to: '2026-12-31' })
  })
  it('الربع (ميلادي)', () => {
    expect(quarterRange(2026, 1)).toEqual({ from: '2026-01-01', to: '2026-03-31' })
    expect(quarterRange(2026, 2)).toEqual({ from: '2026-04-01', to: '2026-06-30' })
    expect(quarterRange(2026, 3)).toEqual({ from: '2026-07-01', to: '2026-09-30' })
    expect(quarterRange(2026, 4)).toEqual({ from: '2026-10-01', to: '2026-12-31' })
    expect(quarterOfMonth(3)).toBe(1)
    expect(quarterOfMonth(4)).toBe(2)
    expect(quarterOfMonth(12)).toBe(4)
  })
  it('القيم غير الصحيحة ترفع خطأ', () => {
    expect(() => monthRange(2026, 13)).toThrow()
    expect(() => quarterRange(2026, 5)).toThrow()
  })
  it('كل الوقت: من بداية المبادرة إلى اليوم', () => {
    expect(allTimeRange('2026-09-01', '2026-11-26')).toEqual({ from: '2026-09-01', to: '2026-11-26' })
    // اليوم قبل البداية (إعداد مستقبلي): الفترة تنهار إلى يوم البداية ولا تنقلب
    expect(allTimeRange('2026-12-01', '2026-11-26')).toEqual({ from: '2026-12-01', to: '2026-12-01' })
  })
  it('clampRange يقصّ الفترة بين بداية المبادرة واليوم', () => {
    expect(clampRange(monthRange(2026, 11), '2026-11-10', '2026-11-26')).toEqual({ from: '2026-11-10', to: '2026-11-26' })
    expect(clampRange(monthRange(2026, 9), '2026-11-10', '2026-11-26')).toBeNull()
    expect(clampRange(monthRange(2026, 12), '2026-11-10', '2026-11-26')).toBeNull()
    expect(clampRange(quarterRange(2026, 4), '2026-01-01', '2026-11-26')).toEqual({ from: '2026-10-01', to: '2026-11-26' })
  })
  it('daysBetweenInclusive', () => {
    expect(daysBetweenInclusive({ from: '2026-01-01', to: '2026-01-31' })).toBe(31)
    expect(daysBetweenInclusive({ from: '2026-02-28', to: '2026-03-01' })).toBe(2)
    expect(daysBetweenInclusive({ from: '2026-05-05', to: '2026-05-05' })).toBe(1)
  })
})
