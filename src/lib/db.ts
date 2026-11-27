import Dexie, { type Table } from 'dexie'
import type { CachedAttendance, MetaRow, Mosque, Participant, QueuedChild, QueuedOp } from './types'

export class AppDb extends Dexie {
  participants!: Table<Participant, string>
  queue!: Table<QueuedOp, string>
  attendanceCache!: Table<CachedAttendance, string>
  meta!: Table<MetaRow, string>
  mosques!: Table<Mosque, string>
  newChildren!: Table<QueuedChild, string>

  constructor(name = 'rijal-al-fajr') {
    super(name)
    this.version(1).stores({
      participants: 'id, name, active',
      queue: 'opId, status, userId, updatedAt, date, [participantId+date]',
      attendanceCache: 'key, date',
      meta: 'key'
    })
    // v2: المساجد
    this.version(2).stores({
      participants: 'id, name, active, mosque_id',
      queue: 'opId, status, userId, updatedAt, date, [participantId+date]',
      attendanceCache: 'key, date',
      meta: 'key',
      mosques: 'id'
    })
    // v3: أطفال أُضيفوا على الجهاز وينتظرون الإرسال
    this.version(3).stores({
      participants: 'id, name, active, mosque_id',
      queue: 'opId, status, userId, updatedAt, date, [participantId+date]',
      attendanceCache: 'key, date',
      meta: 'key',
      mosques: 'id',
      newChildren: 'id, status, userId, mosque_id'
    })
  }
}

export const db = new AppDb()

export async function getMeta<T>(d: AppDb, key: string): Promise<T | undefined> {
  return (await d.meta.get(key))?.value as T | undefined
}
export async function setMeta(d: AppDb, key: string, value: unknown): Promise<void> {
  await d.meta.put({ key, value })
}

export const attendanceKey = (date: string, participantId: string) => `${date}|${participantId}`

/**
 * يستبدل كاش الحضور المعروف من الخادم لتاريخ معيّن.
 * لو مُرِّر fetchStartedAt: العمليات "المتزامنة" محليًا التي لا أثر لها في رد الخادم (أُلغي حضورها أو حُذف من جهاز آخر)
 * تُحذف حتى لا يظهر الطفل "حاضرًا" وهو غير مسجَّل فعلًا. ما حدث بعد بدء الجلب لا يُمس (سباق مع مزامنة جارية).
 */
export async function replaceAttendanceCache(
  d: AppDb,
  date: string,
  participantIds: string[],
  fetchStartedAt?: number
): Promise<void> {
  await d.transaction('rw', d.attendanceCache, d.queue, async () => {
    await d.attendanceCache.where('date').equals(date).delete()
    await d.attendanceCache.bulkPut(
      participantIds.map((participantId) => ({ key: attendanceKey(date, participantId), date, participantId }))
    )
    if (fetchStartedAt !== undefined) {
      const onServer = new Set(participantIds)
      await d.queue
        .where('date')
        .equals(date)
        .and((o) => o.status === 'synced' && !onServer.has(o.participantId) && o.updatedAt < fetchStartedAt)
        .delete()
    }
  })
}

/** يمسح أي أثر محلي لحضور طفل في تاريخ (بعد إلغائه من الخادم) */
export async function clearLocalAttendance(d: AppDb, participantId: string, date: string): Promise<void> {
  await d.transaction('rw', d.attendanceCache, d.queue, async () => {
    await d.attendanceCache.delete(attendanceKey(date, participantId))
    await d.queue
      .where('[participantId+date]')
      .equals([participantId, date])
      .and((o) => o.status === 'synced' || o.status === 'failed')
      .delete()
  })
}

/** يستبدل قائمة الأطفال المخزنة محليًا (يُستدعى بعد جلب ناجح من الخادم فقط) */
export async function replaceParticipants(d: AppDb, rows: Participant[]): Promise<void> {
  await d.transaction('rw', d.participants, async () => {
    await d.participants.clear()
    await d.participants.bulkPut(rows)
  })
}

export async function replaceMosques(d: AppDb, rows: Mosque[]): Promise<void> {
  await d.transaction('rw', d.mosques, async () => {
    await d.mosques.clear()
    await d.mosques.bulkPut(rows)
  })
}
