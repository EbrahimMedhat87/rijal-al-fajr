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
