import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDb, attendanceKey } from '../src/lib/db'
import {
  BackendError, SyncEngine,
  type AttendanceBackend, type RecordInput, type RecordResult
} from '../src/lib/sync'

// ---------------------------------------------------------------------------
// خادم وهمي يطبّق نفس قواعد الـ SQL: idempotency بـ opId + سجل صالح واحد لكل طفل/يوم
// ---------------------------------------------------------------------------
class FakeServer {
  byOp = new Map<string, string>() // opId -> key
  valid = new Map<string, string>() // `${participantId}|${date}` -> opId
  online = true
  calls = 0
  failNext: BackendError | null = null
  loseResponseNext = false
  delayMs = 0
  strict = false // true: حضور طفل غير موجود في الخادم يُرفض نهائيًا (كالإنتاج)
  children = new Map<string, { name: string; mosqueId: string }>()
  childCalls = 0
  rejectChildren: string | null = null // كود رفض نهائي لإنشاء الأطفال
  loseChildResponseNext = false

  backend(): AttendanceBackend {
    return { record: (i) => this.handle(i), createParticipant: (i) => this.createChild(i) }
  }

  private async createChild(i: { id: string; name: string; mosqueId: string }): Promise<void> {
    this.childCalls++
    if (!this.online) throw new BackendError('NETWORK', true)
    if (this.rejectChildren) throw new BackendError(this.rejectChildren, false)
    const ex = this.children.get(i.id)
    if (ex && (ex.name !== i.name || ex.mosqueId !== i.mosqueId)) throw new BackendError('ERR_INVALID_INPUT', false)
    this.children.set(i.id, { name: i.name, mosqueId: i.mosqueId })
    if (this.loseChildResponseNext) {
      this.loseChildResponseNext = false
      throw new BackendError('NETWORK', true)
    }
  }

  private async handle(i: RecordInput): Promise<RecordResult> {
    this.calls++
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs))
    if (!this.online) throw new BackendError('NETWORK', true)
    if (this.failNext) {
      const e = this.failNext
      this.failNext = null
      throw e
    }
    if (this.strict && !this.children.has(i.participantId)) throw new BackendError('ERR_PARTICIPANT_NOT_FOUND', false)
    const key = `${i.participantId}|${i.date}`
    let result: RecordResult
    if (this.byOp.has(i.opId)) result = { status: 'already_synced' }
    else if (this.valid.has(key)) result = { status: 'already_recorded' }
    else {
      this.byOp.set(i.opId, key)
      this.valid.set(key, i.opId)
      result = { status: 'created' }
    }
    if (this.loseResponseNext) {
      // الخادم نفّذ، لكن الرد ضاع في الطريق
      this.loseResponseNext = false
      throw new BackendError('NETWORK', true)
    }
    return result
  }

  validCount() {
    return this.valid.size
  }
}

let n = 0
let db: AppDb
let server: FakeServer
let engine: SyncEngine
const U1 = 'user-1'
const U2 = 'user-2'
const D = '2026-11-26'

beforeEach(() => {
  db = new AppDb(`test-${++n}`)
  server = new FakeServer()
  engine = new SyncEngine(db, server.backend())
})

describe('الحفظ المحلي الفوري (بدون إنترنت)', () => {
  it('enqueue يحفظ العملية pending فورًا بدون أي اتصال بالخادم', async () => {
    server.online = false
    const r = await engine.enqueue(U1, 'p1', D)
    expect(r.kind).toBe('queued')
    expect(server.calls).toBe(0)
    const rows = await db.queue.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'pending', participantId: 'p1', date: D, userId: U1, attempts: 0 })
    expect(rows[0].opId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('كل عملية لها opId فريد', async () => {
    await engine.enqueue(U1, 'p1', D)
    await engine.enqueue(U1, 'p2', D)
    const ids = (await db.queue.toArray()).map((o) => o.opId)
    expect(new Set(ids).size).toBe(2)
  })

  it('منع التكرار المحلي: نفس الطفل/اليوم مرتين لا ينتج إلا عملية واحدة (حتى مع ضغطتين سريعتين)', async () => {
    const [a, b] = await Promise.all([engine.enqueue(U1, 'p1', D), engine.enqueue(U1, 'p1', D)])
    expect([a.kind, b.kind].sort()).toEqual(['already_present', 'queued'])
    expect(await db.queue.count()).toBe(1)
  })

  it('لو الخادم يعرف الحضور (من الكاش) لا تُنشأ عملية جديدة', async () => {
    await db.attendanceCache.put({ key: attendanceKey(D, 'p1'), date: D, participantId: 'p1' })
    const r = await engine.enqueue(U1, 'p1', D)
    expect(r).toEqual({ kind: 'already_present', source: 'server' })
    expect(await db.queue.count()).toBe(0)
  })

  it('نفس الطفل في يوم مختلف مسموح', async () => {
    await engine.enqueue(U1, 'p1', '2026-11-25')
    const r = await engine.enqueue(U1, 'p1', '2026-11-26')
    expect(r.kind).toBe('queued')
  })
})

describe('المزامنة', () => {
  it('تنجح: synced بعد تأكيد الخادم فقط + تحديث الكاش', async () => {
    await engine.enqueue(U1, 'p1', D)
    await engine.enqueue(U1, 'p2', D)
    const s = await engine.syncAll(U1)
    expect(s).toMatchObject({ sent: 2, created: 2, failed: 0, remaining: 0, stoppedByTransientError: false })
    const rows = await db.queue.toArray()
    expect(rows.every((o) => o.status === 'synced' && o.serverResult === 'created')).toBe(true)
    expect(await db.attendanceCache.count()).toBe(2)
    expect(server.validCount()).toBe(2)
  })

  it('لا تُعلَّم synced قبل رد الخادم: أثناء الإرسال الحالة syncing', async () => {
    server.delayMs = 30
    await engine.enqueue(U1, 'p1', D)
    const p = engine.syncAll(U1)
    await new Promise((r) => setTimeout(r, 10))
    expect((await db.queue.toArray())[0].status).toBe('syncing')
    await p
    expect((await db.queue.toArray())[0].status).toBe('synced')
  })

  it('انقطاع الاتصال: تبقى pending، لا يضيع شيء، وتتوقف الجولة', async () => {
    await engine.enqueue(U1, 'p1', D)
    await engine.enqueue(U1, 'p2', D)
    server.online = false
    const s = await engine.syncAll(U1)
    expect(s).toMatchObject({ sent: 0, remaining: 2, stoppedByTransientError: true, lastErrorCode: 'NETWORK' })
    expect(server.calls).toBe(1) // توقفنا عند أول فشل ولم نطرق الخادم لكل عملية
    const rows = await db.queue.toArray()
    expect(rows.every((o) => o.status === 'pending')).toBe(true)
    expect(rows.find((o) => o.attempts > 0)).toBeTruthy()
    expect(server.validCount()).toBe(0)
  })

  it('إعادة المحاولة بعد عودة الاتصال تنجح وتحفظ كل السجلات', async () => {
    await engine.enqueue(U1, 'p1', D)
    await engine.enqueue(U1, 'p2', D)
    server.online = false
    await engine.syncAll(U1)
    server.online = true
    const s = await engine.syncAll(U1)
    expect(s).toMatchObject({ sent: 2, created: 2, remaining: 0 })
    expect(server.validCount()).toBe(2)
  })

  it('الرد ضاع بعد أن نفّذ الخادم: إعادة الإرسال بنفس opId لا تكرّر السجل (already_synced)', async () => {
    await engine.enqueue(U1, 'p1', D)
    server.loseResponseNext = true
    const s1 = await engine.syncAll(U1)
    expect(s1.stoppedByTransientError).toBe(true)
    expect(server.validCount()).toBe(1) // الخادم سجّل فعلًا
    expect((await db.queue.toArray())[0].status).toBe('pending') // ونحن لا نعرف بعد
    const s2 = await engine.syncAll(U1)
    expect(s2.sent).toBe(1)
    expect((await db.queue.toArray())[0]).toMatchObject({ status: 'synced', serverResult: 'already_synced' })
    expect(server.validCount()).toBe(1)
  })

  it('إغلاق التطبيق أثناء الإرسال (syncing عالقة): تعود pending وتُرسل بأمان عند الفتح', async () => {
    await engine.enqueue(U1, 'p1', D)
    const op = (await db.queue.toArray())[0]
    // نحاكي: الخادم استلم، والتطبيق أُغلق قبل تحديث الحالة
    server.byOp.set(op.opId, `p1|${D}`)
    server.valid.set(`p1|${D}`, op.opId)
    await db.queue.update(op.opId, { status: 'syncing' })

    const engine2 = new SyncEngine(db, server.backend()) // "إعادة فتح التطبيق" بمحرك جديد على نفس IndexedDB
    const s = await engine2.syncAll(U1)
    expect(s.sent).toBe(1)
    expect((await db.queue.toArray())[0]).toMatchObject({ status: 'synced', serverResult: 'already_synced' })
    expect(server.validCount()).toBe(1)
  })

  it('إغلاق/إعادة فتح التطبيق: العمليات المعلّقة تبقى في IndexedDB وتُزامَن لاحقًا', async () => {
    server.online = false
    await engine.enqueue(U1, 'p1', D)
    db.close()
    const reopened = new AppDb(db.name) // نفس قاعدة البيانات = إعادة فتح
    const engine2 = new SyncEngine(reopened, server.backend())
    expect(await reopened.queue.count()).toBe(1)
    expect((await reopened.queue.toArray())[0].status).toBe('pending')
    server.online = true
    const s = await engine2.syncAll(U1)
    expect(s).toMatchObject({ sent: 1, created: 1 })
    reopened.close()
  })

  it('جولتان متزامنتان لا ترسلان نفس العملية مرتين', async () => {
    server.delayMs = 10
    await engine.enqueue(U1, 'p1', D)
    await engine.enqueue(U1, 'p2', D)
    const [a, b] = await Promise.all([engine.syncAll(U1), engine.syncAll(U1)])
    expect(a).toBe(b) // نفس الجولة
    expect(server.calls).toBe(2)
  })
})

describe('جهازان لنفس الطفل/اليوم', () => {
  it('الأول created والثاني already_recorded: سجل صالح واحد، والعدّاد سليم، والمنظم يُبلَّغ', async () => {
    const dbB = new AppDb(`test-b-${n}`)
    const engineA = engine
    const engineB = new SyncEngine(dbB, server.backend())

    // كلاهما بدون إنترنت سجّل نفس الطفل
    await engineA.enqueue(U1, 'p1', D)
    await engineB.enqueue(U2, 'p1', D)

    const sA = await engineA.syncAll(U1)
    const sB = await engineB.syncAll(U2)

    expect(sA).toMatchObject({ created: 1, alreadyRecorded: 0 })
    expect(sB).toMatchObject({ created: 0, alreadyRecorded: 1, failed: 0 })
    expect(server.validCount()).toBe(1)

    // عملية الجهاز الثاني تُعتبر مؤكدة (synced) مع تنبيه، ولا تبقى معلّقة للأبد
    expect((await dbB.queue.toArray())[0]).toMatchObject({ status: 'synced', serverResult: 'already_recorded' })
    // والكاش المحلي في الجهاز الثاني يعرف أن الطفل حاضر
    expect(await dbB.attendanceCache.get(attendanceKey(D, 'p1'))).toBeTruthy()
    dbB.close()
  })

  it('جهازان لأطفال مختلفين: كل شيء يُسجَّل', async () => {
    const dbB = new AppDb(`test-c-${n}`)
    const engineB = new SyncEngine(dbB, server.backend())
    await engine.enqueue(U1, 'p1', D)
    await engineB.enqueue(U2, 'p2', D)
    await engine.syncAll(U1)
    await engineB.syncAll(U2)
    expect(server.validCount()).toBe(2)
    dbB.close()
  })
})

describe('الرفض النهائي والفشل', () => {
  it('رفض نهائي ⇒ failed (لا إعادة محاولة تلقائية) ولا يوقف باقي العمليات', async () => {
    await engine.enqueue(U1, 'p1', D)
    await engine.enqueue(U1, 'p2', D)
    server.failNext = new BackendError('ERR_DATE_NOT_ALLOWED', false)
    const s = await engine.syncAll(U1)
    expect(s).toMatchObject({ sent: 1, failed: 1, remaining: 0, stoppedByTransientError: false })
    const rows = await db.queue.toArray()
    expect(rows.filter((o) => o.status === 'failed')).toHaveLength(1)
    expect(rows.find((o) => o.status === 'failed')!.errorCode).toBe('ERR_DATE_NOT_ALLOWED')
    // جولة ثانية لا تعيد إرسال الفاشلة
    const calls = server.calls
    await engine.syncAll(U1)
    expect(server.calls).toBe(calls)
  })

  it('retryFailed تعيدها pending ثم تنجح', async () => {
    await engine.enqueue(U1, 'p1', D)
    server.failNext = new BackendError('ERR_UNKNOWN', false)
    await engine.syncAll(U1)
    const failed = (await db.queue.toArray())[0]
    expect(failed.status).toBe('failed')
    await engine.retryFailed(failed.opId)
    expect((await db.queue.get(failed.opId))!.status).toBe('pending')
    const s = await engine.syncAll(U1)
    expect(s.created).toBe(1)
  })

  it('discardFailed تحذف الفاشلة فقط ولا تحذف pending أو synced أبدًا', async () => {
    await engine.enqueue(U1, 'p1', D) // سيصبح synced
    await engine.syncAll(U1)
    await engine.enqueue(U1, 'p2', D) // يبقى pending
    const [synced, pending] = (await db.queue.toArray()).sort((a, b) => a.updatedAt - b.updatedAt)
    expect(await engine.discardFailed(pending.opId)).toBe(false)
    expect(await engine.discardFailed(synced.opId)).toBe(false)
    expect(await db.queue.count()).toBe(2)
  })

  it('انتهاء الجلسة (AUTH_EXPIRED) transient: السجلات تبقى pending', async () => {
    await engine.enqueue(U1, 'p1', D)
    server.failNext = new BackendError('AUTH_EXPIRED', true)
    const s = await engine.syncAll(U1)
    expect(s).toMatchObject({ stoppedByTransientError: true, lastErrorCode: 'AUTH_EXPIRED', remaining: 1 })
    expect((await db.queue.toArray())[0].status).toBe('pending')
  })

  it('خطأ غير متوقع (ليس BackendError) يُعامَل كانقطاع مؤقت ولا يضيّع السجل', async () => {
    await engine.enqueue(U1, 'p1', D)
    const boom: AttendanceBackend = { record: async () => { throw new Error('boom') }, createParticipant: async () => { throw new Error('boom') } }
    const e2 = new SyncEngine(db, boom)
    const s = await e2.syncAll(U1)
    expect(s.stoppedByTransientError).toBe(true)
    expect((await db.queue.toArray())[0].status).toBe('pending')
  })
})

describe('النسب للمستخدم الصحيح', () => {
  it('لا تُزامَن عمليات مستخدم آخر تحت حساب مختلف (تبقى محفوظة)', async () => {
    await engine.enqueue(U1, 'p1', D)
    await engine.enqueue(U2, 'p2', D)
    const s = await engine.syncAll(U2)
    expect(s.sent).toBe(1)
    const rows = await db.queue.toArray()
    expect(rows.find((o) => o.userId === U1)!.status).toBe('pending')
    expect(rows.find((o) => o.userId === U2)!.status).toBe('synced')
    // وعند دخول المستخدم الأول تُرسل عملياته
    const s1 = await engine.syncAll(U1)
    expect(s1.sent).toBe(1)
    expect(server.validCount()).toBe(2)
  })
})

describe('التنظيف', () => {
  it('purgeOldSynced يحذف synced القديمة فقط', async () => {
    let t = 1_000_000
    const e = new SyncEngine(db, server.backend(), () => t)
    await e.enqueue(U1, 'old', D)
    await e.syncAll(U1) // synced عند t
    t += 10 * 24 * 3600 * 1000 // بعد 10 أيام
    await e.enqueue(U1, 'new-pending', D) // pending
    await e.enqueue(U1, 'new-synced', D)
    await e.syncAll(U1)
    await e.enqueue(U1, 'still-pending', D) // يبقى pending
    server.online = false
    await e.syncAll(U1) // يفشل transient ⇒ pending
    const removed = await e.purgeOldSynced(7 * 24 * 3600 * 1000)
    expect(removed).toBe(1)
    const left = await db.queue.toArray()
    expect(left.map((o) => o.participantId).sort()).toEqual(['new-pending', 'new-synced', 'still-pending'].sort())
    expect(left.filter((o) => o.status === 'pending').length).toBeGreaterThanOrEqual(1)
  })
})

describe('إضافة طفل بدون إنترنت', () => {
  const M = 'mosque-1'

  it('enqueueChild يحفظ الطفل محليًا فورًا بدون أي اتصال', async () => {
    server.online = false
    const c = await engine.enqueueChild(U1, '  علي حسن ', M)
    expect(server.childCalls).toBe(0)
    expect(c).toMatchObject({ name: 'علي حسن', mosque_id: M, status: 'pending' })
    expect(await db.newChildren.count()).toBe(1)
  })

  it('بعد عودة الاتصال: الطفل يُنشأ ثم يُحذف من الطابور ويظهر في participants', async () => {
    server.online = false
    const c = await engine.enqueueChild(U1, 'علي حسن', M)
    expect((await engine.syncAll(U1)).stoppedByTransientError).toBe(true)
    expect(await db.newChildren.count()).toBe(1) // لم يضِع شيء
    server.online = true
    const s = await engine.syncAll(U1)
    expect(s.childrenCreated).toBe(1)
    expect(server.children.get(c.id)).toEqual({ name: 'علي حسن', mosqueId: M })
    expect(await db.newChildren.count()).toBe(0)
    expect(await db.participants.get(c.id)).toMatchObject({ name: 'علي حسن', mosque_id: M, active: true })
  })

  it('حضور طفل جديد أوفلاين: الطفل يُرسَل أولًا ثم حضوره (لا رفض)', async () => {
    server.strict = true
    server.online = false
    const c = await engine.enqueueChild(U1, 'علي حسن', M)
    expect((await engine.enqueue(U1, c.id, D)).kind).toBe('queued')
    server.online = true
    const s = await engine.syncAll(U1)
    expect(s).toMatchObject({ childrenCreated: 1, created: 1, failed: 0, remaining: 0 })
    expect(server.validCount()).toBe(1)
  })

  it('ضياع الرد بعد إنشاء الطفل: إعادة الإرسال بنفس المعرّف لا تُكرّره', async () => {
    const c = await engine.enqueueChild(U1, 'علي حسن', M)
    server.loseChildResponseNext = true
    expect((await engine.syncAll(U1)).stoppedByTransientError).toBe(true)
    expect(server.children.size).toBe(1) // الخادم أنشأه فعلًا
    expect((await db.newChildren.get(c.id))?.status).toBe('pending')
    const s = await engine.syncAll(U1)
    expect(s.childrenCreated).toBe(1)
    expect(server.children.size).toBe(1) // ما زال واحدًا
  })

  it('انقطاع الاتصال أثناء إرسال الأطفال: يتوقف ولا يرسل الحضور قبل الطفل', async () => {
    server.strict = true
    const c = await engine.enqueueChild(U1, 'علي', M)
    await engine.enqueue(U1, c.id, D)
    server.online = false
    const s = await engine.syncAll(U1)
    expect(s).toMatchObject({ stoppedByTransientError: true, remaining: 2 })
    expect((await db.queue.toArray())[0].status).toBe('pending')
  })

  it('رفض نهائي للطفل: يصير failed وحضوره يصير failed بسببه، وإعادة المحاولة تُعيدهما', async () => {
    server.strict = true
    server.rejectChildren = 'ERR_MOSQUE_NOT_ALLOWED'
    const c = await engine.enqueueChild(U1, 'علي', M)
    await engine.enqueue(U1, c.id, D)
    const s = await engine.syncAll(U1)
    expect(s.childrenFailed).toBe(1)
    expect((await db.newChildren.get(c.id))?.status).toBe('failed')
    const op = (await db.queue.toArray())[0]
    expect(op).toMatchObject({ status: 'failed', errorCode: 'ERR_CHILD_NOT_SAVED' })

    server.rejectChildren = null
    await engine.retryFailedChild(c.id)
    expect((await db.queue.toArray())[0].status).toBe('pending')
    const s2 = await engine.syncAll(U1)
    expect(s2).toMatchObject({ childrenCreated: 1, created: 1, failed: 0 })
  })

  it('discardFailedChild يحذف الفاشل وحضوره فقط ولا يمس الطفل الناجح', async () => {
    const ok = await engine.enqueueChild(U1, 'سليم', M)
    await engine.syncAll(U1)
    server.rejectChildren = 'ERR_MOSQUE_NOT_ALLOWED'
    const bad = await engine.enqueueChild(U1, 'فاشل', M)
    await engine.enqueue(U1, bad.id, D)
    await engine.syncAll(U1)
    expect(await engine.discardFailedChild(ok.id)).toBe(false)
    expect(await engine.discardFailedChild(bad.id)).toBe(true)
    expect(await db.queue.count()).toBe(0)
    expect(await db.newChildren.count()).toBe(0)
  })

  it('طفل pending لا يُحذف بـ discardFailedChild', async () => {
    const c = await engine.enqueueChild(U1, 'علي', M)
    expect(await engine.discardFailedChild(c.id)).toBe(false)
    expect(await db.newChildren.count()).toBe(1)
  })

  it('syncing معلّق (إغلاق مفاجئ) يرجع pending ويُرسَل بأمان', async () => {
    const c = await engine.enqueueChild(U1, 'علي', M)
    await db.newChildren.update(c.id, { status: 'syncing' })
    const s = await engine.syncAll(U1)
    expect(s.childrenCreated).toBe(1)
  })

  it('لا تُرسَل أطفال مستخدم آخر', async () => {
    await engine.enqueueChild(U2, 'علي', M)
    const s = await engine.syncAll(U1)
    expect(s.childrenCreated).toBe(0)
    expect(server.children.size).toBe(0)
    expect(await db.newChildren.count()).toBe(1)
  })
})
