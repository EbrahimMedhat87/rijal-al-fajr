import { type AppDb, attendanceKey } from './db'
import type { QueuedOp, ServerResult } from './types'
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
export interface AttendanceBackend {
  record(input: RecordInput): Promise<RecordResult>
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
  remaining: number // ما زال pending بعد هذه الجولة
  stoppedByTransientError: boolean
  lastErrorCode?: string
}

const emptySummary = (): SyncSummary => ({
  sent: 0,
  created: 0,
  alreadyRecorded: 0,
  failed: 0,
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

  /** عمليات كانت "قيد الإرسال" عند إغلاق التطبيق فجأة ⇒ ترجع pending (الخادم يتعرف على نفس opId) */
  async recoverInterrupted(userId: string): Promise<number> {
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

    summary.remaining = await db.queue.where('status').equals('pending').and((o) => o.userId === userId).count()
    return summary
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
