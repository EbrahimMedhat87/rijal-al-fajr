import { useEffect, useMemo, useState, useDeferredValue } from 'react'
import MosqueSwitcher from '../components/MosqueSwitcher'
import { Badge, Banner, Button, Chip, ChildNo, Empty, Modal, inputClass } from '../components/ui'
import { useAppData } from '../lib/app-data'
import { canManage, useSession } from '../lib/auth'
import { refreshAttendanceDate, undoAttendance } from '../lib/data'
import { db } from '../lib/db'
import { formatArabicDate } from '../lib/dates'
import { arabicError, errorToArabic } from '../lib/errors'
import { useLive, useOnline } from '../lib/hooks'
import { useAllParticipants, type LocalParticipant } from '../lib/participants'
import { useSync } from '../lib/sync-context'
import { compareByNumberQuery, isNumericQuery, matchesQuery } from '../lib/text'
import { useToast } from '../lib/toast'
import type { QueuedOp } from '../lib/types'

type RowState = 'none' | 'synced' | 'pending' | 'failed'
interface RowInfo {
  state: RowState
  op?: QueuedOp
}
type Filter = 'all' | 'todo' | 'done'

export default function Attendance() {
  const session = useSession()
  const { today, campaign, mosques, selectedMosque, mosqueName } = useAppData()
  const { engine, userId, syncNow } = useSync()
  const toast = useToast()
  const online = useOnline()
  const manage = canManage(session.profile.role)

  const [dateOverride, setDateOverride] = useState<string | null>(null)
  const date = manage && dateOverride ? dateOverride : today
  const [query, setQuery] = useState('')
  // البحث فوري (على الجهاز، بدون زر): نتائج كل حرف تظهر مباشرة، و useDeferredValue يمنع تقطيع الكتابة لو القائمة كبيرة
  const dq = useDeferredValue(query)
  const [filter, setFilter] = useState<Filter>('all')
  const [undoing, setUndoing] = useState<LocalParticipant | null>(null)
  const [undoBusy, setUndoBusy] = useState(false)

  const participants = useAllParticipants()
  const scoped = useMemo(
    () => participants?.filter((p) => selectedMosque === 'all' || p.mosque_id === selectedMosque),
    [participants, selectedMosque]
  )
  const showMosque = selectedMosque === 'all' && mosques.length > 1
  const cache = useLive(() => db.attendanceCache.where('date').equals(date).toArray(), [date])
  const ops = useLive(() => db.queue.where('date').equals(date).toArray(), [date])

  // تحديث الكاش من الخادم عند تغيير التاريخ أو عودة الاتصال
  useEffect(() => {
    if (online) refreshAttendanceDate(date).catch(() => {})
  }, [date, online])

  const info = useMemo(() => {
    const m = new Map<string, RowInfo>()
    cache?.forEach((c) => m.set(c.participantId, { state: 'synced' }))
    ops?.forEach((o) => {
      const cur = m.get(o.participantId)
      if (o.status === 'synced') m.set(o.participantId, { state: 'synced', op: o })
      else if (o.status === 'pending' || o.status === 'syncing') {
        if (cur?.state !== 'synced') m.set(o.participantId, { state: 'pending', op: o })
      } else if (o.status === 'failed' && !cur) m.set(o.participantId, { state: 'failed', op: o })
    })
    return m
  }, [cache, ops])

  const list = useMemo(() => {
    if (!scoped) return []
    return scoped
      .filter((p) => p.active || (info.get(p.id)?.state ?? 'none') !== 'none')
      .filter((p) => matchesQuery(p.name, dq, p.child_no))
      .filter((p) => {
        const done = (info.get(p.id)?.state ?? 'none') !== 'none' && info.get(p.id)?.state !== 'failed'
        return filter === 'all' ? true : filter === 'done' ? done : !done
      })
      .sort((a, b) => (isNumericQuery(dq) ? compareByNumberQuery(dq, a, b) : 0) || a.name.localeCompare(b.name, 'ar'))
  }, [scoped, info, dq, filter])

  const activeCount = scoped?.filter((p) => p.active).length ?? 0
  const presentCount = useMemo(() => {
    const ids = new Set((scoped ?? []).map((p) => p.id))
    return [...info.entries()].filter(([id, v]) => ids.has(id) && (v.state === 'synced' || v.state === 'pending')).length
  }, [info, scoped])

  const mark = async (p: LocalParticipant) => {
    const cur = info.get(p.id)?.state ?? 'none'
    if (cur === 'synced' || cur === 'pending') return
    const r = await engine.enqueue(userId, p.id, date)
    if (r.kind === 'already_present') {
      toast('info', `${p.name} مسجَّل حاضرًا بالفعل`)
      return
    }
    navigator.vibrate?.(30)
    if (navigator.onLine) void syncNow()
    else toast('success', `تم حفظ حضور ${p.name} على هذا الجهاز — بانتظار المزامنة`)
  }

  const confirmUndo = async () => {
    const p = undoing
    if (!p) return
    const cur = info.get(p.id)?.state ?? 'none'
    setUndoBusy(true)
    try {
      if (cur === 'pending') {
        // لم يصل للخادم بعد: يُحذف من الجهاز فقط (يعمل بدون إنترنت)
        const r = await engine.cancelPending(p.id, date)
        if (r === 'busy') {
          toast('info', 'جارٍ إرسال الحضور الآن — جرّب الإلغاء بعد ثوانٍ')
          return
        }
        toast('success', `أُلغي حضور ${p.name}`)
      } else {
        if (!navigator.onLine) {
          toast('error', 'إلغاء حضور وصل للخادم يحتاج إنترنت — جرّب لما يرجع الاتصال')
          return
        }
        const r = await undoAttendance(p.id, date)
        toast('success', r === 'stale' ? `${p.name}: لم يكن له حضور مسجَّل على الخادم — تم تصحيح الشاشة` : `أُلغي حضور ${p.name}`)
      }
      setUndoing(null)
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? ''
      toast('error', /ERR_NOT_AUTHORIZED/.test(msg) ? 'تقدر تلغي الحضور اللي سجّلته أنت فقط (والمشرف يلغي أي حضور)' : errorToArabic(e))
    } finally {
      setUndoBusy(false)
    }
  }

  if (participants && participants.length === 0) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-bold text-brand-900">تسجيل الحضور</h1>
        <Banner tone="gold">
          لا توجد قائمة أطفال على هذا الجهاز. {online ? 'جارٍ التحميل… أو أضف الأطفال من صفحة "الأطفال" (للمشرف).' : 'افتح التطبيق مع الإنترنت مرة واحدة لتحميل القائمة.'}
        </Banner>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-brand-900">تسجيل الحضور</h1>
          <p className="text-sm text-brand-700">{formatArabicDate(date)}</p>
        </div>
        <div className="text-center">
          <div className="text-3xl font-extrabold leading-none text-brand-900">{presentCount}</div>
          <div className="mt-1 text-xs text-brand-700">من {activeCount}</div>
        </div>
      </div>

      <MosqueSwitcher />

      {manage && (
        <div className="mb-3 flex items-center gap-2">
          <label className="shrink-0 text-sm font-semibold text-brand-900" htmlFor="att-date">التاريخ</label>
          <input
            id="att-date"
            type="date"
            dir="ltr"
            className={inputClass}
            value={date}
            min={campaign?.start_date}
            max={today}
            onChange={(e) => setDateOverride(e.target.value && e.target.value !== today ? e.target.value : null)}
          />
          {date !== today && (
            <Button variant="secondary" onClick={() => setDateOverride(null)}>اليوم</Button>
          )}
        </div>
      )}
      {date !== today && (
        <div className="mb-3"><Banner tone="gold">أنت تسجّل لتاريخ سابق، وليس لليوم.</Banner></div>
      )}

      <div className="sticky top-0 z-20 -mx-4 space-y-2 bg-cream px-4 pb-3 pt-2 shadow-[0_6px_6px_-6px_rgba(0,0,0,0.25)]">
        <input
          type="search"
          className={inputClass}
          placeholder="ابحث بالاسم أو الرقم…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="بحث بالاسم أو الرقم"
          enterKeyHint="done"
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <div className="flex gap-2 overflow-x-auto">
          <Chip active={filter === 'all'} onClick={() => setFilter('all')}>الكل</Chip>
          <Chip active={filter === 'todo'} onClick={() => setFilter('todo')}>لم يُسجَّل</Chip>
          <Chip active={filter === 'done'} onClick={() => setFilter('done')}>حاضر</Chip>
        </div>
      </div>

      {list.length === 0 ? (
        <Empty>{query ? 'لا توجد نتائج مطابقة' : filter === 'todo' ? 'تم تسجيل الجميع 🎉' : 'لا يوجد أحد في هذه القائمة'}</Empty>
      ) : (
        <ul className="space-y-2">
          {list.map((p) => {
            const row = info.get(p.id) ?? { state: 'none' as RowState }
            return <Row key={p.id} p={p} row={row} mosque={showMosque ? mosqueName(p.mosque_id) : ''} onMark={() => void mark(p)} onUndo={() => setUndoing(p)} />
          })}
        </ul>
      )}

      {undoing && (
        <Modal title="إلغاء الحضور" onClose={() => !undoBusy && setUndoing(null)}>
          <div className="space-y-4">
            <p className="text-base text-brand-900">
              إلغاء حضور <b>{undoing.name}</b> ليوم {formatArabicDate(date)}؟
            </p>
            <p className="text-xs text-brand-700">بيرجع الطفل "لم يُسجَّل"، وتقدر تسجّله حاضرًا تاني. العملية تُسجَّل في سجل التدقيق.</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setUndoing(null)} disabled={undoBusy}>رجوع</Button>
              <Button variant="danger" block disabled={undoBusy} onClick={() => void confirmUndo()}>
                {undoBusy ? 'جارٍ الإلغاء…' : 'نعم، ألغِ الحضور'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Row({ p, row, mosque, onMark, onUndo }: { p: LocalParticipant; row: RowInfo; mosque: string; onMark: () => void; onUndo: () => void }) {
  const present = row.state === 'synced' || row.state === 'pending'
  const style = {
    none: 'border-brand-200 bg-white active:bg-brand-50',
    synced: 'border-brand-300 bg-brand-100',
    pending: 'border-gold-400 bg-gold-100',
    failed: 'border-red-300 bg-red-50'
  }[row.state]

  return (
    <li className={`flex min-h-16 items-stretch rounded-2xl border ${style}`}>
      <button
        type="button"
        onClick={onMark}
        disabled={present}
        aria-label={`${p.name} — ${row.state === 'none' ? 'تسجيل حضور' : row.state === 'synced' ? 'حاضر' : row.state === 'pending' ? 'محفوظ على الجهاز بانتظار المزامنة' : 'فشل'}`}
        className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-2xl px-4 py-3 text-start"
      >
        <span className="flex min-w-0 items-center gap-3">
          <ChildNo n={p.child_no} />
          <span className="min-w-0">
            <span className="block truncate text-lg font-semibold text-brand-900">{p.name}</span>
            {mosque && <span className="block text-xs text-brand-700">{mosque}</span>}
            {!p.active && <span className="text-xs text-brand-700">موقوف</span>}
            {p.pending && <span className="block text-xs text-gold-700">طفل جديد — لم يُرسَل للخادم بعد</span>}
            {row.state === 'synced' && row.op?.serverResult === 'already_recorded' && (
              <span className="block text-xs text-brand-700">سُجِّل مسبقًا من جهاز آخر</span>
            )}
            {row.state === 'failed' && <span className="block text-xs text-red-800">{arabicError(row.op?.errorCode)}</span>}
          </span>
        </span>
        <span className="shrink-0">
          {row.state === 'none' && <span className="inline-flex min-h-11 items-center rounded-xl bg-brand-900 px-5 text-base font-bold text-white">حاضر</span>}
          {row.state === 'synced' && <Badge tone="green">✓ حاضر</Badge>}
          {row.state === 'pending' && (
            <span className="block text-end">
              <Badge tone="gold">✓ محفوظ على الجهاز</Badge>
              <span className="mt-1 block text-[11px] text-gold-700">بانتظار المزامنة</span>
            </span>
          )}
          {row.state === 'failed' && <Badge tone="red">✕ فشل — اضغط للمحاولة</Badge>}
        </span>
      </button>
      {present && (
        <button
          type="button"
          onClick={onUndo}
          aria-label={`إلغاء حضور ${p.name}`}
          className="my-2 me-2 flex shrink-0 items-center justify-center rounded-xl border border-red-300 bg-white px-3 text-sm font-bold text-red-800 active:bg-red-50"
        >
          إلغاء
        </button>
      )}
    </li>
  )
}
