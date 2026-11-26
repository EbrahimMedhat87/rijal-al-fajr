import { useEffect, useMemo, useState } from 'react'
import { Badge, Banner, Button, Chip, Empty, inputClass } from '../components/ui'
import { useAppData } from '../lib/app-data'
import { canManage, useSession } from '../lib/auth'
import { refreshAttendanceDate } from '../lib/data'
import { db } from '../lib/db'
import { formatArabicDate } from '../lib/dates'
import { arabicError } from '../lib/errors'
import { useLive, useOnline } from '../lib/hooks'
import { useSync } from '../lib/sync-context'
import { matchesQuery } from '../lib/text'
import { useToast } from '../lib/toast'
import type { Participant, QueuedOp } from '../lib/types'

type RowState = 'none' | 'synced' | 'pending' | 'failed'
interface RowInfo {
  state: RowState
  op?: QueuedOp
}
type Filter = 'all' | 'todo' | 'done'

export default function Attendance() {
  const session = useSession()
  const { today, campaign } = useAppData()
  const { engine, userId, syncNow } = useSync()
  const toast = useToast()
  const online = useOnline()
  const manage = canManage(session.profile.role)

  const [dateOverride, setDateOverride] = useState<string | null>(null)
  const date = manage && dateOverride ? dateOverride : today
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const participants = useLive(() => db.participants.toArray())
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
    if (!participants) return []
    return participants
      .filter((p) => p.active || (info.get(p.id)?.state ?? 'none') !== 'none')
      .filter((p) => matchesQuery(p.name, query))
      .filter((p) => {
        const done = (info.get(p.id)?.state ?? 'none') !== 'none' && info.get(p.id)?.state !== 'failed'
        return filter === 'all' ? true : filter === 'done' ? done : !done
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
  }, [participants, info, query, filter])

  const activeCount = participants?.filter((p) => p.active).length ?? 0
  const presentCount = useMemo(
    () => [...info.entries()].filter(([, v]) => v.state === 'synced' || v.state === 'pending').length,
    [info]
  )

  const mark = async (p: Participant) => {
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

      <div className="sticky z-20 -mx-4 space-y-2 bg-cream/95 px-4 pb-3 pt-2 backdrop-blur" style={{ top: 'var(--header-h, 6.5rem)' }}>
        <input
          type="search"
          className={inputClass}
          placeholder="ابحث بالاسم…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="بحث بالاسم"
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
            return <Row key={p.id} p={p} row={row} onMark={() => void mark(p)} />
          })}
        </ul>
      )}
    </div>
  )
}

function Row({ p, row, onMark }: { p: Participant; row: RowInfo; onMark: () => void }) {
  const disabled = row.state === 'synced' || row.state === 'pending'
  const style = {
    none: 'border-brand-200 bg-white active:bg-brand-50',
    synced: 'border-brand-300 bg-brand-100',
    pending: 'border-gold-400 bg-gold-100',
    failed: 'border-red-300 bg-red-50'
  }[row.state]

  return (
    <li>
      <button
        type="button"
        onClick={onMark}
        disabled={disabled}
        aria-label={`${p.name} — ${row.state === 'none' ? 'تسجيل حضور' : row.state === 'synced' ? 'حاضر' : row.state === 'pending' ? 'محفوظ على الجهاز بانتظار المزامنة' : 'فشل'}`}
        className={`flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-start ${style}`}
      >
        <span className="min-w-0">
          <span className="block truncate text-lg font-semibold text-brand-900">{p.name}</span>
          {!p.active && <span className="text-xs text-brand-700">موقوف</span>}
          {row.state === 'synced' && row.op?.serverResult === 'already_recorded' && (
            <span className="block text-xs text-brand-700">سُجِّل مسبقًا من جهاز آخر</span>
          )}
          {row.state === 'failed' && <span className="block text-xs text-red-800">{arabicError(row.op?.errorCode)}</span>}
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
    </li>
  )
}
