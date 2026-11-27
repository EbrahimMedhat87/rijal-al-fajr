import { type AppDb, attendanceKey } from './db'
import type { QueuedChild, QueuedOp, ServerResult } from './types'
import { uuid } from './uuid'

// ---------------------------------------------------------------------------
// عقد الـ backend (يُحقن في المحرك: Supabase في الإنتاج، نسخة وهمية في الاختبار)
// ---------------------------------------------------------------------------
export interface RecordInput {
  opId: string
  participantId: string
  date: string
  deviceCreatedAt: string
}
export interface RecordResult {
  status: ServerResult
  attendanceId?: string
}
export interface CreateParticipantInput {
  id: string
  name: string
  mosqueId: string
}
export interface AttendanceBackend {
  record(input: RecordInput): Promise<RecordResult>
  /** idempotent بالمعرّف: إعادة الإرسال بعد ضياع الرد لا تُنشئ تكرارًا */
  createParticipant(input: CreateParticipantInput): Promise<void>
}

/** transient=true: مشكلة اتصال/خادم/جلسة — نعيد المحاولة لاحقًا ولا نفقد شيئًا.
 *  transient=false: رفض نهائي من الخادم (صلاحية/تاريخ…) — يظهر كـ "فشل" ويحتاج تدخل المنظم. */
export class BackendError extends Error {
  constructor(
    public readonly code: string,
    public readonly transient: boolean,
    message?: string
  ) {
    super(message ?? code)
    this.name = 'BackendError'
  }
}

export type EnqueueResult =
  | { kind: 'queued'; op: QueuedOp }
  | { kind: 'already_present'; source: 'server' | 'local' }

export interface SyncSummary {
  sent: number
  created: number
  alreadyRecorded: number // وُجد سجل لنفس الطفل/اليوم من جهاز آخر
  failed: number
  childrenCreated: number
  childrenFailed: number
  remaining: number // ما زال pending بعد هذه الجولة
  stoppedByTransientError: boolean
  lastErrorCode?: string
}

const emptySummary = (): SyncSummary => ({
  sent: 0,
  created: 0,
  alreadyRecorded: 0,
  failed: 0,
  childrenCreated: 0,
  childrenFailed: 0,
  remaining: 0,
  stoppedByTransientError: false
})

export class SyncEngine {
  private running: Promise<SyncSummary> | null = null

  constructor(
    private readonly db: AppDb,
    private readonly backend: AttendanceBackend,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** يحفظ العملية محليًا فورًا (قبل أي اتصال). يمنع التكرار المحلي للطفل/اليوم. */
  async enqueue(userId: string, participantId: string, date: string): Promise<EnqueueResult> {
    const { db } = this
    return db.transaction('rw', db.queue, db.attendanceCache, async () => {
      if (await db.attendanceCache.get(attendanceKey(date, participantId))) {
        return { kind: 'already_present', source: 'server' } as const
      }
      const existing = await db.queue.where('[participantId+date]').equals([participantId, date]).toArray()
      if (existing.some((o) => o.status !== 'failed')) {
        return { kind: 'already_present', source: 'local' } as const
      }
      const t = this.now()
      const op: QueuedOp = {
        opId: uuid(),
        userId,
        participantId,
        date,
        deviceCreatedAt: new Date(t).toISOString(),
        status: 'pending',
        attempts: 0,
        updatedAt: t
      }
      await db.queue.add(op)
      return { kind: 'queued', op } as const
    })
  }

  /** يحفظ طفلًا جديدًا محليًا (يظهر فورًا في القوائم والتحضير) ويُرسَل للخادم في المزامنة. */
  async enqueueChild(userId: string, name: string, mosqueId: string): Promise<QueuedChild> {
    const child: QueuedChild = {
      id: uuid(),
      userId,
      name: name.trim(),
      mosque_id: mosqueId,
      status: 'pending',
      attempts: 0,
      updatedAt: this.now()
    }
    await this.db.newChildren.add(child)
    return child
  }

  /** عمليات كانت "قيد الإرسال" عند إغلاق التطبيق فجأة ⇒ ترجع pending (الخادم يتعرف على نفس opId) */
  async recoverInterrupted(userId: string): Promise<number> {
    await this.db.newChildren
      .where('status')
      .equals('syncing')
      .and((c) => c.userId === userId)
      .modify({ status: 'pending', updatedAt: this.now() })
    return this.db.queue
      .where('status')
      .equals('syncing')
      .and((o) => o.userId === userId)
      .modify({ status: 'pending', updatedAt: this.now() })
  }

  /** جولة مزامنة واحدة في كل مرة؛ استدعاءات متزامنة تنتظر نفس الجولة. */
  syncAll(userId: string): Promise<SyncSummary> {
    if (this.running) return this.running
    this.running = this.run(userId).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async run(userId: string): Promise<SyncSummary> {
    const { db } = this
    const summary = emptySummary()
    await this.recoverInterrupted(userId)

    // 1) الأطفال الجدد أولًا: حضورهم لا يُرسَل قبل وجودهم في الخادم
    const kids = (await db.newChildren.where('status').equals('pending').and((c) => c.userId === userId).toArray()).sort(
      (a, b) => a.updatedAt - b.updatedAt
    )
    for (const kid of kids) {
      await db.newChildren.update(kid.id, { status: 'syncing', updatedAt: this.now() })
      try {
        await this.backend.createParticipant({ id: kid.id, name: kid.name, mosqueId: kid.mosque_id })
        await db.transaction('rw', db.newChildren, db.participants, async () => {
          await db.participants.put({ id: kid.id, name: kid.name, active: true, mosque_id: kid.mosque_id })
          await db.newChildren.delete(kid.id)
        })
        summary.childrenCreated++
      } catch (e) {
        const err = e instanceof BackendError ? e : new BackendError('NETWORK', true, String(e))
        if (err.transient) {
          await db.newChildren.update(kid.id, { status: 'pending', attempts: kid.attempts + 1, errorCode: err.code, updatedAt: kid.updatedAt })
          summary.stoppedByTransientError = true
          summary.lastErrorCode = err.code
          summary.remaining = await this.countPending(userId)
          return summary
        }
        await db.transaction('rw', db.newChildren, db.queue, async () => {
          await db.newChildren.update(kid.id, { status: 'failed', attempts: kid.attempts + 1, errorCode: err.code, updatedAt: this.now() })
          // حضور هذا الطفل لن يُقبل: نعلّمه فاشلًا بسببه (يرجع تلقائيًا لو أُعيدت محاولة الطفل)
          await db.queue
            .where('participantId')
            .equals(kid.id)
            .and((o) => o.status === 'pending' || o.status === 'syncing')
            .modify({ status: 'failed', errorCode: 'ERR_CHILD_NOT_SAVED', updatedAt: this.now() })
        })
        summary.childrenFailed++
        summary.lastErrorCode = err.code
      }
    }

    const ops = (await db.queue.where('status').equals('pending').and((o) => o.userId === userId).toArray()).sort(
      (a, b) => a.updatedAt - b.updatedAt
    )

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]
      await db.queue.update(op.opId, { status: 'syncing', updatedAt: this.now() })
      try {
        const res = await this.backend.record({
          opId: op.opId,
          participantId: op.participantId,
          date: op.date,
          deviceCreatedAt: op.deviceCreatedAt
        })
        // تأكيد الخادم وصل ⇒ فقط الآن نعلّمها synced
        await db.transaction('rw', db.queue, db.attendanceCache, async () => {
          await db.queue.update(op.opId, {
            status: 'synced',
            serverResult: res.status,
            errorCode: undefined,
            updatedAt: this.now()
          })
          await db.attendanceCache.put({
            key: attendanceKey(op.date, op.participantId),
            date: op.date,
            participantId: op.participantId
          })
        })
        summary.sent++
        if (res.status === 'created') summary.created++
        if (res.status === 'already_recorded') summary.alreadyRecorded++
      } catch (e) {
        const err = e instanceof BackendError ? e : new BackendError('NETWORK', true, String(e))
        if (err.transient) {
          // لا نحذف شيئًا: نرجّعها pending ونوقف الجولة (لا فائدة من الاستمرار بدون اتصال)
          await db.queue.update(op.opId, {
            status: 'pending',
            attempts: op.attempts + 1,
            errorCode: err.code,
            updatedAt: op.updatedAt // نحافظ على ترتيبها الأصلي
          })
          summary.stoppedByTransientError = true
          summary.lastErrorCode = err.code
          break
        }
        await db.queue.update(op.opId, {
          status: 'failed',
          attempts: op.attempts + 1,
          errorCode: err.code,
          updatedAt: this.now()
        })
        summary.failed++
        summary.lastErrorCode = err.code
      }
    }

    summary.remaining = await this.countPending(userId)
    return summary
  }

  private async countPending(userId: string): Promise<number> {
    const [a, c] = await Promise.all([
      this.db.queue.where('status').equals('pending').and((o) => o.userId === userId).count(),
      this.db.newChildren.where('status').equals('pending').and((k) => k.userId === userId).count()
    ])
    return a + c
  }

  /** إعادة محاولة طفل فاشل (وحضوره الذي فشل بسببه) */
  async retryFailedChild(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.newChildren, this.db.queue, async () => {
      await this.db.newChildren
        .where('id')
        .equals(id)
        .and((c) => c.status === 'failed')
        .modify({ status: 'pending', attempts: 0, errorCode: undefined, updatedAt: this.now() })
      await this.db.queue
        .where('participantId')
        .equals(id)
        .and((o) => o.status === 'failed' && o.errorCode === 'ERR_CHILD_NOT_SAVED')
        .modify({ status: 'pending', attempts: 0, errorCode: undefined, updatedAt: this.now() })
    })
  }

  /** حذف طفل فاشل (وحضوره المرتبط به) من هذا الجهاز بقرار صريح. لا يمس أي طفل غير فاشل. */
  async discardFailedChild(id: string): Promise<boolean> {
    const c = await this.db.newChildren.get(id)
    if (!c || c.status !== 'failed') return false
    await this.db.transaction('rw', this.db.newChildren, this.db.queue, async () => {
      await this.db.newChildren.delete(id)
      await this.db.queue.where('participantId').equals(id).and((o) => o.status === 'failed').delete()
    })
    return true
  }

  /** إعادة محاولة عملية فاشلة (بطلب المنظم) */
  async retryFailed(opId: string): Promise<void> {
    await this.db.queue
      .where('opId')
      .equals(opId)
      .and((o) => o.status === 'failed')
      .modify({ status: 'pending', attempts: 0, errorCode: undefined, updatedAt: this.now() })
  }

  /** حذف عملية فاشلة نهائيًا (بقرار صريح من المنظم). لا يحذف أي عملية غير فاشلة أبدًا. */
  async discardFailed(opId: string): Promise<boolean> {
    const op = await this.db.queue.get(opId)
    if (!op || op.status !== 'failed') return false
    await this.db.queue.delete(opId)
    return true
  }

  /** تنظيف عمليات synced القديمة فقط (لا يمس pending/syncing/failed) */
  async purgeOldSynced(olderThanMs: number): Promise<number> {
    const cutoff = this.now() - olderThanMs
    return this.db.queue
      .where('status')
      .equals('synced')
      .and((o) => o.updatedAt < cutoff)
      .delete()
  }
}
