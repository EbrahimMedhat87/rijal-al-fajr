// كل التواريخ في التطبيق نصوص YYYY-MM-DD بتوقيت المبادرة (افتراضيًا Africa/Cairo).
// لا نستخدم Date المحلي للجهاز إطلاقًا في تحديد "اليوم" لتجنب انزياح التاريخ.
import type { DateRange } from './types'

export const DEFAULT_TZ = 'Africa/Cairo'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isValidDateStr(s: string): boolean {
  const m = DATE_RE.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

/** تاريخ اليوم (YYYY-MM-DD) في منطقة زمنية معيّنة لحظة `now` */
export function todayInTz(tz: string = DEFAULT_TZ, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function toUtc(s: string): Date {
  if (!isValidDateStr(s)) throw new Error(`Invalid date: ${s}`)
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function fmt(dt: Date): string {
  const y = String(dt.getUTCFullYear()).padStart(4, '0')
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDays(s: string, n: number): string {
  const dt = toUtc(s)
  dt.setUTCDate(dt.getUTCDate() + n)
  return fmt(dt)
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0 // YYYY-MM-DD تُقارَن نصيًا بشكل صحيح
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate() // month: 1..12
}

export function monthRange(year: number, month: number): DateRange {
  if (month < 1 || month > 12) throw new Error(`Invalid month: ${month}`)
  const mm = String(month).padStart(2, '0')
  return {
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${String(daysInMonth(year, month)).padStart(2, '0')}`
  }
}

/** الأرباع بالتقويم الميلادي: 1=يناير–مارس، 2=أبريل–يونيو، 3=يوليو–سبتمبر، 4=أكتوبر–ديسمبر */
export function quarterRange(year: number, quarter: number): DateRange {
  if (quarter < 1 || quarter > 4) throw new Error(`Invalid quarter: ${quarter}`)
  const startMonth = (quarter - 1) * 3 + 1
  const endMonth = startMonth + 2
  return { from: monthRange(year, startMonth).from, to: monthRange(year, endMonth).to }
}

export function quarterOfMonth(month: number): number {
  return Math.floor((month - 1) / 3) + 1
}

export function allTimeRange(startDate: string, today: string): DateRange {
  return { from: startDate, to: compareDates(today, startDate) < 0 ? startDate : today }
}

/** يقصّ الفترة داخل [campaignStart, today]؛ يرجع null لو الفترة كلها خارج النطاق */
export function clampRange(range: DateRange, campaignStart: string, today: string): DateRange | null {
  const from = compareDates(range.from, campaignStart) < 0 ? campaignStart : range.from
  const to = compareDates(range.to, today) > 0 ? today : range.to
  return compareDates(from, to) > 0 ? null : { from, to }
}

export function parseYearMonth(s: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(s)
  if (!m) throw new Error(`Invalid year-month: ${s}`)
  return { year: Number(m[1]), month: Number(m[2]) }
}

/** عدد الأيام في الفترة (شامل الطرفين) */
export function daysBetweenInclusive(r: DateRange): number {
  const ms = toUtc(r.to).getTime() - toUtc(r.from).getTime()
  return Math.round(ms / 86_400_000) + 1
}

const AR_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
]
const AR_QUARTERS = ['الربع الأول', 'الربع الثاني', 'الربع الثالث', 'الربع الرابع']

export const arabicMonthName = (month: number) => AR_MONTHS[month - 1]
export const arabicQuarterName = (q: number) => AR_QUARTERS[q - 1]

/** عرض تاريخ بالعربية (أرقام لاتينية للوضوح في القوائم) */
export function formatArabicDate(s: string): string {
  const dt = toUtc(s)
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(dt)
}

export function formatArabicShort(s: string): string {
  const { year, month } = parseYearMonth(s.slice(0, 7))
  return `${Number(s.slice(8, 10))} ${AR_MONTHS[month - 1]} ${year}`
}

/** "YYYY-MM-DD HH:mm" بتوقيت المنطقة المعطاة (للتقارير) */
export function formatDateTimeInTz(iso: string, tz: string = DEFAULT_TZ): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(iso))
  const g = (t: string) => parts.find((p) => p.type === t)!.value
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`
}
