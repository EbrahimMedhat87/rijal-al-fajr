import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge, Banner, Button, Card, Empty, Field, Modal, Spinner, inputClass } from '../components/ui'
import { useAppData } from '../lib/app-data'
import { canManage, useSession } from '../lib/auth'
import {
  countValidDays, fetchParticipantHistory, fetchProfileNames, updateParticipant, voidAttendance,
  type AttendanceRowDb
} from '../lib/data'
import { db } from '../lib/db'
import { allTimeRange, formatArabicShort, monthRange, quarterOfMonth, quarterRange } from '../lib/dates'
import { arabicError, errorToArabic } from '../lib/errors'
import { useLive, useOnline } from '../lib/hooks'
import { useToast } from '../lib/toast'

export default function ParticipantDetail() {
  const { id = '' } = useParams()
  const session = useSession()
  const { today, campaign } = useAppData()
  const online = useOnline()
  const toast = useToast()
  const manage = canManage(session.profile.role)

  const participant = useLive(() => db.participants.get(id), [id])
  const local = useLive(() => db.queue.where('participantId').equals(id).and((o) => o.status !== 'synced').toArray(), [id])

  const [totals, setTotals] = useState<{ month: number; quarter: number; all: number } | null>(null)
  const [history, setHistory] = useState<AttendanceRowDb[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [limit, setLimit] = useState(60)
  const [voiding, setVoiding] = useState<AttendanceRowDb | null>(null)
  const [reason, setReason] = useState('')
  const [editing, setEditing] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!manage || !campaign || !navigator.onLine) return
    try {
      const y = Number(today.slice(0, 4))
      const m = Number(today.slice(5, 7))
      const month = monthRange(y, m)
      const quarter = quarterRange(y, quarterOfMonth(m))
      const all = allTimeRange(campaign.start_date, today)
      const [a, b, c, h, n] = await Promise.all([
        countValidDays(id, { from: month.from < campaign.start_date ? campaign.start_date : month.from, to: today }),
        countValidDays(id, { from: quarter.from < campaign.start_date ? campaign.start_date : quarter.from, to: today }),
        countValidDays(id, all),
        fetchParticipantHistory(id, limit),
        fetchProfileNames()
      ])
      setTotals({ month: a, quarter: b, all: c })
      setHistory(h)
      setNames(n)
      setLoadError(null)
    } catch (e) {
      setLoadError(errorToArabic(e))
    }
  }, [id, manage, campaign, today, limit])

  useEffect(() => {
    void load()
  }, [load, online])

  if (participant === undefined) return <Spinner />
  if (!participant) {
    return (
      <Empty>
        الطفل غير موجود على هذا الجهاز. <Link className="font-semibold underline" to="/participants">العودة للقائمة</Link>
      </Empty>
    )
  }

  const doVoid = async (e: FormEvent) => {
    e.preventDefault()
    if (!voiding) return
    setBusy(true)
    setFormError(null)
    try {
      await voidAttendance(voiding.id, reason)
      toast('success', 'تم إبطال السجل وتسجيله في سجل التدقيق')
      setVoiding(null)
      setReason('')
      await load()
    } catch (err) {
      setFormError(errorToArabic(err))
    } finally {
      setBusy(false)
    }
  }

  const doRename = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setFormError(null)
    try {
      await updateParticipant(id, { name: newName })
      toast('success', 'تم حفظ الاسم')
      setEditing(false)
    } catch (err) {
      setFormError(errorToArabic(err))
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async () => {
    const msg = participant.active
      ? `إيقاف ${participant.name}؟\nلن يظهر في قائمة التحضير، لكن يبقى كل تاريخ حضوره محفوظًا ويمكن إعادة تفعيله.`
      : `إعادة تفعيل ${participant.name}؟`
    if (!window.confirm(msg)) return
    try {
      await updateParticipant(id, { active: !participant.active })
      toast('success', participant.active ? 'تم إيقاف الطفل' : 'تمت إعادة التفعيل')
    } catch (err) {
      toast('error', errorToArabic(err))
    }
  }

  return (
    <div className="space-y-4">
      <Link to="/participants" className="text-sm font-semibold text-brand-700">← الأطفال</Link>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">{participant.name}</h1>
          <div className="mt-1">{participant.active ? <Badge tone="green">نشط</Badge> : <Badge tone="gray">موقوف</Badge>}</div>
        </div>
      </div>

      {manage && (
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" disabled={!online} onClick={() => { setNewName(participant.name); setEditing(true); setFormError(null) }}>
            تعديل الاسم
          </Button>
          <Button variant="secondary" className="flex-1" disabled={!online} onClick={() => void toggleActive()}>
            {participant.active ? 'إيقاف' : 'إعادة تفعيل'}
          </Button>
        </div>
      )}

      {local && local.length > 0 && (
        <Banner tone="gold">
          يوجد {local.length} سجل على هذا الجهاز لم يتأكد من الخادم بعد:{' '}
          {local.map((o) => `${o.date} (${o.status === 'failed' ? 'فشل' : 'بانتظار المزامنة'})`).join('، ')}
        </Banner>
      )}

      {!manage ? (
        <Card className="text-sm text-brand-700">سجل الحضور الكامل والإحصاءات متاحة للمشرف والمالك.</Card>
      ) : !online && !history ? (
        <Banner tone="blue">سجل الحضور يحتاج اتصالًا بالإنترنت.</Banner>
      ) : loadError ? (
        <Banner tone="red">{loadError}</Banner>
      ) : !history || !totals ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Card className="!p-3"><div className="text-xs text-brand-700">هذا الشهر</div><div className="text-3xl font-extrabold text-brand-900">{totals.month}</div></Card>
            <Card className="!p-3"><div className="text-xs text-brand-700">هذا الربع</div><div className="text-3xl font-extrabold text-brand-900">{totals.quarter}</div></Card>
            <Card className="!p-3"><div className="text-xs text-brand-700">منذ البداية</div><div className="text-3xl font-extrabold text-brand-900">{totals.all}</div></Card>
          </div>

          <Card>
            <h2 className="mb-3 font-bold text-brand-900">سجل الحضور</h2>
            {history.length === 0 ? (
              <p className="text-sm text-brand-700">لا توجد سجلات.</p>
            ) : (
              <ul className="divide-y divide-brand-100">
                {history.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className={`font-semibold ${r.status === 'void' ? 'text-gray-500 line-through' : 'text-brand-900'}`}>{formatArabicShort(r.attendance_date)}</div>
                      <div className="text-xs text-brand-700">
                        سجّله: {names[r.recorded_by] ?? '—'}
                        {r.status === 'void' && <span className="text-red-800"> · مُبطَل: {r.void_reason}</span>}
                      </div>
                    </div>
                    {r.status === 'valid' ? (
                      <Button variant="ghost" className="!min-h-10 text-red-700" disabled={!online} onClick={() => { setVoiding(r); setReason(''); setFormError(null) }}>
                        إبطال
                      </Button>
                    ) : (
                      <Badge tone="red">مُبطَل</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {history.length >= limit && (
              <div className="mt-3"><Button variant="secondary" block onClick={() => setLimit((l) => l + 60)}>عرض المزيد</Button></div>
            )}
          </Card>
        </>
      )}

      {voiding && (
        <Modal title="إبطال سجل حضور" onClose={() => setVoiding(null)}>
          <form onSubmit={doVoid} className="space-y-4">
            {formError && <Banner tone="red">{formError}</Banner>}
            <p className="text-sm text-brand-800">
              سيُبطَل حضور <b>{participant.name}</b> بتاريخ <b>{formatArabicShort(voiding.attendance_date)}</b>. لا يُحذف السجل، بل يبقى في التاريخ كمُبطَل ويُكتب في سجل التدقيق.
            </p>
            <Field label="سبب الإبطال (مطلوب)">
              <textarea className={inputClass} rows={3} required value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            </Field>
            <Button type="submit" variant="danger" block disabled={busy || !reason.trim()}>
              {busy ? 'جارٍ الإبطال…' : 'تأكيد الإبطال'}
            </Button>
          </form>
        </Modal>
      )}

      {editing && (
        <Modal title="تعديل الاسم" onClose={() => setEditing(false)}>
          <form onSubmit={doRename} className="space-y-4">
            {formError && <Banner tone="red">{formError}</Banner>}
            <Field label="الاسم">
              <input className={inputClass} value={newName} maxLength={100} required autoFocus onChange={(e) => setNewName(e.target.value)} />
            </Field>
            <Button type="submit" block disabled={busy || !newName.trim()}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</Button>
          </form>
        </Modal>
      )}
      {formError && !voiding && !editing && <Banner tone="red">{arabicError(undefined, formError)}</Banner>}
    </div>
  )
}
