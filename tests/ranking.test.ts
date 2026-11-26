import { describe, expect, it } from 'vitest'
import { rankParticipants, totalDays } from '../src/lib/ranking'

const row = (name: string, days: number, active = true) => ({ participantId: name, name, active, days })

describe('rankParticipants — competition ranking', () => {
  it('1، 1، 3 عند التعادل في المركز الأول', () => {
    const r = rankParticipants([row('أحمد', 10), row('محمد', 10), row('يوسف', 7)])
    expect(r.map((x) => x.rank)).toEqual([1, 1, 3])
  })
  it('1، 2، 2، 4 عند التعادل في المركز الثاني', () => {
    const r = rankParticipants([row('أ', 9), row('ب', 8), row('ج', 8), row('د', 5)])
    expect(r.map((x) => x.rank)).toEqual([1, 2, 2, 4])
  })
  it('تعادل ثلاثي ثم التالي يأخذ المركز 4', () => {
    const r = rankParticipants([row('أ', 5), row('ب', 5), row('ج', 5), row('د', 4)])
    expect(r.map((x) => x.rank)).toEqual([1, 1, 1, 4])
  })
  it('الترتيب تنازلي بعدد الأيام بغض النظر عن ترتيب الإدخال', () => {
    const r = rankParticipants([row('ج', 1), row('أ', 30), row('ب', 12)])
    expect(r.map((x) => x.name)).toEqual(['أ', 'ب', 'ج'])
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3])
  })
  it('المتعادلون يُرتَّبون أبجديًا للثبات فقط، ورتبتهم واحدة', () => {
    const r = rankParticipants([row('يوسف', 4), row('أحمد', 4), row('خالد', 4)])
    expect(r.map((x) => x.name)).toEqual(['أحمد', 'خالد', 'يوسف'])
    expect(new Set(r.map((x) => x.rank))).toEqual(new Set([1]))
  })
  it('من لا حضور له غير مُرتَّب (rank=null) ويأتي آخرًا ولا يأخذ المركز الأول', () => {
    const r = rankParticipants([row('أ', 0), row('ب', 3), row('ج', 0)])
    expect(r[0]).toMatchObject({ name: 'ب', rank: 1 })
    expect(r.slice(1).every((x) => x.rank === null)).toBe(true)
  })
  it('الجميع صفر: لا أحد يُرتَّب', () => {
    const r = rankParticipants([row('أ', 0), row('ب', 0)])
    expect(r.every((x) => x.rank === null)).toBe(true)
  })
  it('قائمة فارغة', () => {
    expect(rankParticipants([])).toEqual([])
  })
  it('لا يعدّل المصفوفة الأصلية', () => {
    const input = [row('ب', 1), row('أ', 2)]
    rankParticipants(input)
    expect(input.map((x) => x.name)).toEqual(['ب', 'أ'])
  })
  it('totalDays يجمع الأيام', () => {
    expect(totalDays([row('أ', 3), row('ب', 4), row('ج', 0)])).toBe(7)
    expect(totalDays([])).toBe(0)
  })
})

import { rankMosques, type MosqueScoreRow } from '../src/lib/ranking'

const mrow = (name: string, children: number, totalDays: number): MosqueScoreRow => ({
  mosqueId: name,
  name,
  children,
  present: totalDays > 0 ? 1 : 0,
  totalDays,
  avgDays: children ? Math.round((totalDays / children) * 100) / 100 : 0
})

describe('rankMosques — ترتيب المساجد بالمتوسط', () => {
  it('المسجد الصغير النشيط يتفوق على الكبير الأقل نشاطًا (متوسط لا إجمالي)', () => {
    const r = rankMosques([mrow('الكبير', 80, 400), mrow('الصغير', 20, 150)]) // 5.00 مقابل 7.50
    expect(r.map((x) => x.name)).toEqual(['الصغير', 'الكبير'])
    expect(r.map((x) => x.rank)).toEqual([1, 2])
  })
  it('تعادل المتوسط يعطي نفس المركز والتالي 3', () => {
    const r = rankMosques([mrow('أ', 10, 50), mrow('ب', 20, 100), mrow('ج', 10, 20)])
    expect(r.map((x) => x.rank)).toEqual([1, 1, 3])
  })
  it('مسجد بلا حضور غير مُرتَّب ويأتي آخرًا', () => {
    const r = rankMosques([mrow('فارغ', 10, 0), mrow('نشيط', 10, 30)])
    expect(r[0]).toMatchObject({ name: 'نشيط', rank: 1 })
    expect(r[1]).toMatchObject({ name: 'فارغ', rank: null })
  })
  it('قائمة فارغة', () => {
    expect(rankMosques([])).toEqual([])
  })
})
