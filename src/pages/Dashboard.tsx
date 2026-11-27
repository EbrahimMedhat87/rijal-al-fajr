import { Link } from 'react-router-dom'
import { Badge, Banner, Button, Card, PageTitle } from '../components/ui'
import { useAppData } from '../lib/app-data'
import { canManage, useSession } from '../lib/auth'
import { db } from '../lib/db'
import { readAllParticipants } from '../lib/participants'
import { formatArabicDate } from '../lib/dates'
import { arabicError } from '../lib/errors'
import { useOnline, useLive } from '../lib/hooks'
import { useSync } from '../lib/sync-context'
import { useToast } from '../lib/toast'

export default function Dashboard() {
  const session = useSession()
  const { today, campaign, refreshError, refreshing, refreshAll } = useAppData()
  const { pendingCount, failedCount, syncNow, syncing, lastSyncAt, lastError, engine, userId } = useSync()
  const online = useOnline()
  const toast = useToast()

  const stats = useLive(async () => {
    const [cache, ops, everyone] = await Promise.all([
      db.attendanceCache.where('date').equals(today).toArray(),
      db.queue.where('date').equals(today).toArray(),
      readAllParticipants(userId)
    ])
    const activeCount = everyone.filter((p) => p.active).length
    const total = everyone.length
    const present = new Set(cache.map((c) => c.participantId))
    ops.filter((o) => o.status !== 'failed').forEach((o) => present.add(o.participantId))
    return { present: present.size, activeCount, total }
  }, [today, userId])

  const failed = useLive(async () => {
    const ops = await db.queue.where('status').equals('failed').and((o) => o.userId === userId).toArray()
    const kids = (await db.newChildren.toArray()).filter((c) => c.userId === userId)
    const names = new Map([...(await db.participants.toArray()), ...kids].map((p) => [p.id, p.name]))
    return {
      ops: ops.map((o) => ({ ...o, name: names.get(o.participantId) ?? 'طفل' })),
      kids: kids.filter((c) => c.status === 'failed')
    }
  }, [userId])

  const noList = stats && stats.total === 0
  const manage = canManage(session.profile.role)

  return (
    <div className="space-y-4">
      <PageTitle title="الرئيسية" subtitle={formatArabicDate(today)} />

      {campaign === null && (
        <Banner tone="red">
          لم تُعدَّ المبادرة بعد. {session.profile.role === 'owner' ? 'افتح صفحة الإدارة لضبط الاسم وتاريخ البداية.' : 'تواصل مع المالك.'}
        </Banner>
      )}
      {noList && (
        <Banner tone="gold">
          قائمة الأطفال غير محمّلة على هذا الجهاز. افتح التطبيق مع الإنترنت مرة واحدة لتحميلها، ثم يمكنك التسجيل بدون إنترنت.
          {online && (
            <div className="mt-2">
              <Button variant="secondary" disabled={refreshing} onClick={() => void refreshAll()}>
                {refreshing ? 'جارٍ التحميل…' : 'تحميل القائمة الآن'}
              </Button>
            </div>
          )}
        </Banner>
      )}
      {refreshError && online && <Banner tone="red">تعذّر تحديث البيانات: {refreshError}</Banner>}

      <div className="grid grid-cols-2 gap-3">
        <Card className="text-center">
          <div className="text-sm text-brand-700">حضروا اليوم</div>
          <div className="mt-1 text-4xl font-extrabold text-brand-900">{stats?.present ?? '—'}</div>
        </Card>
        <Card className="text-center">
          <div className="text-sm text-brand-700">الأطفال النشطون</div>
          <div className="mt-1 text-4xl font-extrabold text-brand-900">{stats?.activeCount ?? '—'}</div>
        </Card>
      </div>

      <Link
        to="/attendance"
        className="flex min-h-16 items-center justify-center gap-2 rounded-2xl bg-gold-500 px-4 text-lg font-bold text-brand-900 shadow-sm active:bg-gold-400"
      >
        ✓ تسجيل الحضور
      </Link>

      <Card>
        <h2 className="mb-3 font-bold text-brand-900">الاتصال والمزامنة</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-brand-700">الاتصال</dt>
            <dd>
              <Badge tone={online ? 'green' : 'red'}>{online ? 'متصل' : 'غير متصل'}</Badge>
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-brand-700">سجلات بانتظار المزامنة</dt>
            <dd>
              <Badge tone={pendingCount > 0 ? 'gold' : 'green'}>{pendingCount}</Badge>
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-brand-700">آخر مزامنة ناجحة</dt>
            <dd className="text-brand-900">
              {lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' }) : '—'}
            </dd>
          </div>
        </dl>
        {lastError && online && <div className="mt-3"><Banner tone="red">{lastError}</Banner></div>}
        <div className="mt-3">
          <Button block variant="secondary" disabled={syncing || !online} onClick={() => void syncNow()}>
            {syncing ? 'جارٍ المزامنة…' : 'مزامنة الآن'}
          </Button>
          {!online && pendingCount > 0 && (
            <p className="mt-2 text-xs text-brand-700">السجلات محفوظة على هذا الجهاز وستُرسَل تلقائيًا عند عودة الإنترنت.</p>
          )}
        </div>
      </Card>

      {failedCount > 0 && failed && (
        <Card className="border-red-200">
          <h2 className="mb-1 font-bold text-red-800">عناصر رفضها الخادم ({failedCount})</h2>
          <p className="mb-3 text-xs text-brand-700">لم تُحتسب هذه السجلات. أعد المحاولة أو احذفها بعد التأكد.</p>
          <ul className="space-y-3">
            {failed.kids.map((c) => (
              <li key={c.id} className="rounded-xl bg-red-50 p-3">
                <div className="font-semibold text-brand-900">إضافة الطفل: {c.name}</div>
                <div className="mt-0.5 text-sm text-red-800">{arabicError(c.errorCode)}</div>
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="secondary"
                    className="flex-1"
                    onClick={async () => {
                      await engine.retryFailedChild(c.id)
                      void syncNow()
                    }}
                  >
                    إعادة المحاولة
                  </Button>
                  <Button
                    variant="ghost"
                    className="flex-1 text-red-700"
                    onClick={async () => {
                      if (window.confirm(`حذف الطفل ${c.name} (وأي حضور مسجَّل له) من هذا الجهاز نهائيًا؟`)) {
                        await engine.discardFailedChild(c.id)
                        toast('info', 'تم الحذف')
                      }
                    }}
                  >
                    حذف
                  </Button>
                </div>
              </li>
            ))}
            {failed.ops.map((o) => (
              <li key={o.opId} className="rounded-xl bg-red-50 p-3">
                <div className="font-semibold text-brand-900">
                  {o.name} · {o.date}
                </div>
                <div className="mt-0.5 text-sm text-red-800">{arabicError(o.errorCode)}</div>
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="secondary"
                    className="flex-1"
                    onClick={async () => {
                      await engine.retryFailed(o.opId)
                      void syncNow()
                    }}
                  >
                    إعادة المحاولة
                  </Button>
                  <Button
                    variant="ghost"
                    className="flex-1 text-red-700"
                    onClick={async () => {
                      if (window.confirm(`حذف سجل حضور ${o.name} بتاريخ ${o.date} نهائيًا من هذا الجهاز؟`)) {
                        await engine.discardFailed(o.opId)
                        toast('info', 'تم حذف السجل الفاشل')
                      }
                    }}
                  >
                    حذف
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {manage && (
        <div className="grid grid-cols-2 gap-3">
          <Link to="/rankings" className="rounded-2xl border border-brand-200 bg-white px-4 py-4 text-center font-semibold text-brand-900 active:bg-brand-50">★ الترتيب</Link>
          <Link to="/reports" className="rounded-2xl border border-brand-200 bg-white px-4 py-4 text-center font-semibold text-brand-900 active:bg-brand-50">▤ التقارير</Link>
        </div>
      )}
    </div>
  )
}
