import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDb, attendanceKey, clearLocalAttendance, replaceAttendanceCache } from '../src/lib/db'
import { SyncEngine, type AttendanceBackend } from '../src/lib/sync'
import { compareByNumberQuery, isNumericQuery, matchesQuery } from '../src/lib/text'
import type { QueuedOp } from '../src/lib/types'

let n = 0
let db: AppDb
let engine: SyncEngine
const D = '2026-11-26'
const backend: AttendanceBackend = {
  record: async () => ({ status: 'created' }),
  createParticipant: async () => undefined
}

const op = (over: Partial<QueuedOp>): QueuedOp => ({
  opId: crypto.randomUUID(),
  userId: 'u',
  participantId: 'p1',
  date: D,
  deviceCreatedAt: new Date(1000).toISOString(),
  status: 'synced',
  attempts: 0,
  updatedAt: 1000,
  ...over
})

beforeEach(() => {
  db = new AppDb(`undo-${++n}`)
  engine = new SyncEngine(db, backend)
})

describe('البحث برقم الطفل', () => {
  it('أرقام فقط ⇒ بحث بالرقم (بداية الرقم)، والاسم يبقى بحثًا بالاسم', () => {
    expect(isNumericQuery('5')).toBe(true)
    expect(isNumericQuery('٥')).toBe(true)
    expect(isNumericQuery('أحمد 5')).toBe(false)
    expect(matchesQuery('آدم فرج', '5', 5)).toBe(true)
    expect(matchesQuery('آدم فرج', '5', 50)).toBe(true)
    expect(matchesQuery('آدم فرج', '5', 15)).toBe(false)
    expect(matchesQuery('آدم فرج', '٥', 5)).toBe(true) // أرقام عربية
    expect(matchesQuery('آدم فرج', '5', null)).toBe(false)
    expect(matchesQuery('آدم فرج', 'ادم')).toBe(true)
    expect(matchesQuery('5 آدم فرج', '5')).toBe(true) // أسماء قديمة فيها رقم داخل الاسم
  })

  it('الرقم المطابق تمامًا يأتي أولًا ثم الأصغر', () => {
    const rows = [{ child_no: 50 }, { child_no: 5 }, { child_no: 51 }]
    expect([...rows].sort((a, b) => compareByNumberQuery('5', a, b)).map((r) => r.child_no)).toEqual([5, 50, 51])
  })
})

describe('إلغاء حضور لم يصل للخادم (cancelPending)', () => {
  it('pending يُحذف بدون إنترنت، وبعدها يمكن التسجيل من جديد', async () => {
    await engine.enqueue('u', 'p1', D)
    expect(await engine.cancelPending('p1', D)).toBe('cancelled')
    expect(await db.queue.count()).toBe(0)
    expect((await engine.enqueue('u', 'p1', D)).kind).toBe('queued')
  })

  it('syncing لا يُحذف (busy) حتى لا يصل للخادم بعد الإلغاء', async () => {
    await db.queue.add(op({ status: 'syncing' }))
    expect(await engine.cancelPending('p1', D)).toBe('busy')
    expect(await db.queue.count()).toBe(1)
  })

  it('لا شيء للإلغاء ⇒ none، و synced لا يُمس (يحتاج الخادم)', async () => {
    expect(await engine.cancelPending('p1', D)).toBe('none')
    await db.queue.add(op({ status: 'synced' }))
    expect(await engine.cancelPending('p1', D)).toBe('none')
    expect(await db.queue.count()).toBe(1)
  })

  it('يمسح فشلًا قديمًا أيضًا، ولا يمس طفلًا/يومًا آخر', async () => {
    await db.queue.add(op({ status: 'failed', opId: 'f1' }))
    await db.queue.add(op({ status: 'pending', participantId: 'p2', opId: 'o2' }))
    await db.queue.add(op({ status: 'pending', date: '2026-11-25', opId: 'o3' }))
    expect(await engine.cancelPending('p1', D)).toBe('cancelled')
    expect((await db.queue.toArray()).map((o) => o.opId).sort()).toEqual(['o2', 'o3'])
  })
})

describe('تنظيف "الحضور الوهمي" المحلي', () => {
  it('عملية synced غير موجودة في رد الخادم تُحذف (أُلغي/حُذف من مكان آخر)', async () => {
    await db.queue.add(op({ opId: 'stale', participantId: 'p1', status: 'synced', updatedAt: 1000 }))
    await db.queue.add(op({ opId: 'ok', participantId: 'p2', status: 'synced', updatedAt: 1000 }))
    await replaceAttendanceCache(db, D, ['p2'], 5000)
    expect((await db.queue.toArray()).map((o) => o.opId)).toEqual(['ok'])
  })

  it('لا تُحذف عملية تزامنت بعد بدء الجلب (سباق)، ولا pending/failed، ولا تاريخ آخر', async () => {
    await db.queue.add(op({ opId: 'fresh', participantId: 'p1', status: 'synced', updatedAt: 6000 }))
    await db.queue.add(op({ opId: 'pend', participantId: 'p3', status: 'pending', updatedAt: 1000 }))
    await db.queue.add(op({ opId: 'fail', participantId: 'p4', status: 'failed', updatedAt: 1000 }))
    await db.queue.add(op({ opId: 'other', participantId: 'p5', status: 'synced', date: '2026-11-20', updatedAt: 1000 }))
    await replaceAttendanceCache(db, D, [], 5000)
    expect((await db.queue.toArray()).map((o) => o.opId).sort()).toEqual(['fail', 'fresh', 'other', 'pend'])
  })

  it('بدون fetchStartedAt السلوك القديم (الكاش فقط)', async () => {
    await db.queue.add(op({ opId: 'x', status: 'synced' }))
    await replaceAttendanceCache(db, D, [])
    expect(await db.queue.count()).toBe(1)
  })

  it('clearLocalAttendance يمسح الكاش والعمليات المتزامنة/الفاشلة لهذا الطفل واليوم فقط', async () => {
    await db.attendanceCache.put({ key: attendanceKey(D, 'p1'), date: D, participantId: 'p1' })
    await db.attendanceCache.put({ key: attendanceKey(D, 'p2'), date: D, participantId: 'p2' })
    await db.queue.add(op({ opId: 'a', participantId: 'p1', status: 'synced' }))
    await db.queue.add(op({ opId: 'b', participantId: 'p2', status: 'synced' }))
    await clearLocalAttendance(db, 'p1', D)
    expect((await db.attendanceCache.toArray()).map((c) => c.participantId)).toEqual(['p2'])
    expect((await db.queue.toArray()).map((o) => o.opId)).toEqual(['b'])
    expect((await engine.enqueue('u', 'p1', D)).kind).toBe('queued') // بعد الإلغاء يمكن إعادة التسجيل
  })
})
