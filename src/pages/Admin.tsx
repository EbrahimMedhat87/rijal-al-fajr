import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Badge, Banner, Button, Card, Field, Modal, PageTitle, Spinner, inputClass } from '../components/ui'
import { useAppData } from '../lib/app-data'
import { canManage, useSession } from '../lib/auth'
import { fetchAudit, fetchProfileNames, listUsers, updateCampaign, upsertUser, type AuditRow, type UserRow } from '../lib/data'
import { formatDateTimeInTz } from '../lib/dates'
import { errorToArabic } from '../lib/errors'
import { useOnline } from '../lib/hooks'
import { useToast } from '../lib/toast'
import type { Role } from '../lib/types'

const ROLE_AR: Record<Role, string> = { owner: 'مالك', admin: 'مشرف', recorder: 'مسجِّل' }
const ACTION_AR: Record<string, string> = {
  'attendance.void': 'إبطال حضور',
  'participants.insert': 'إضافة طفل',
  'participants.update': 'تعديل طفل',
  'profiles.insert': 'إضافة منظم',
  'profiles.update': 'تعديل منظم',
  'profiles.delete': 'حذف منظم',
  'campaigns.insert': 'إنشاء المبادرة',
  'campaigns.update': 'تعديل إعدادات المبادرة'
}

export default function Admin() {
  const session = useSession()
  const { campaign } = useAppData()
  const online = useOnline()
  const toast = useToast()
  const isOwner = session.profile.role === 'owner'

  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [audit, setAudit] = useState<AuditRow[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [editUser, setEditUser] = useState<Partial<UserRow> & { isNew?: boolean } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [cName, setCName] = useState('')
  const [cStart, setCStart] = useState('')
  const [cTz, setCTz] = useState('Africa/Cairo')

  useEffect(() => {
    if (campaign) {
      setCName(campaign.name)
      setCStart(campaign.start_date)
      setCTz(campaign.timezone)
    }
  }, [campaign])

  const load = useCallback(async () => {
    if (!navigator.onLine) return
    try {
      const [a, n] = await Promise.all([fetchAudit(100), fetchProfileNames()])
      setAudit(a)
      setNames(n)
      if (isOwner) setUsers(await listUsers())
      setError(null)
    } catch (e) {
      setError(errorToArabic(e))
    }
  }, [isOwner])

  useEffect(() => {
    void load()
  }, [load, online])

  if (!canManage(session.profile.role)) return <Navigate to="/" replace />

  const saveUser = async (e: FormEvent) => {
    e.preventDefault()
    if (!editUser) return
    setBusy(true)
    setFormError(null)
    try {
      await upsertUser(editUser.email ?? '', editUser.display_name ?? '', (editUser.role ?? 'recorder') as Role, editUser.active ?? true)
      toast('success', 'تم حفظ المنظم')
      setEditUser(null)
      await load()
    } catch (err) {
      setFormError(errorToArabic(err))
    } finally {
      setBusy(false)
    }
  }

  const saveCampaign = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await updateCampaign(cName, cStart, cTz)
      toast('success', 'تم حفظ إعدادات المبادرة')
      await load()
    } catch (err) {
      setError(errorToArabic(err))
    } finally {
      setBusy(false)
    }
  }

  const tz = campaign?.timezone ?? 'Africa/Cairo'

  return (
    <div className="space-y-4">
      <PageTitle title="الإدارة" />
      {!online && <Banner tone="blue">الإدارة تحتاج اتصالًا بالإنترنت.</Banner>}
      {error && <Banner tone="red">{error}</Banner>}

      {isOwner ? (
        <>
          <Card>
            <h2 className="mb-3 font-bold text-brand-900">إعدادات المبادرة</h2>
            <form onSubmit={saveCampaign} className="space-y-3">
              <Field label="الاسم"><input className={inputClass} value={cName} onChange={(e) => setCName(e.target.value)} required /></Field>
              <Field label="تاريخ البداية" hint="يبدأ منه حساب الترتيب. لا يمكن تأخيره بعد وجود حضور قبله.">
                <input className={inputClass} type="date" dir="ltr" value={cStart} onChange={(e) => setCStart(e.target.value)} required />
              </Field>
              <Field label="المنطقة الزمنية" hint="تحدد اليوم الصحيح لتسجيل الحضور (الافتراضي Africa/Cairo).">
                <input className={inputClass} dir="ltr" value={cTz} onChange={(e) => setCTz(e.target.value)} required />
              </Field>
              <Button type="submit" block disabled={busy || !online}>{busy ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}</Button>
            </form>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold text-brand-900">المنظمون</h2>
              <Button variant="secondary" disabled={!online} onClick={() => { setEditUser({ isNew: true, role: 'recorder', active: true }); setFormError(null) }}>+ إضافة</Button>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-brand-700">
              لا يوجد تسجيل عام. أنشئ الحساب أولًا من لوحة Supabase (Authentication ← Users ← Add user)، ثم اربطه هنا بنفس البريد وحدد دوره.
            </p>
            {!users ? <Spinner /> : (
              <ul className="divide-y divide-brand-100">
                {users.map((u) => (
                  <li key={u.user_id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-brand-900">{u.display_name}</div>
                      <div className="truncate text-xs text-brand-700" dir="ltr">{u.email}</div>
                      <div className="mt-1 flex gap-1.5"><Badge tone="green">{ROLE_AR[u.role]}</Badge>{!u.active && <Badge tone="red">موقوف</Badge>}</div>
                    </div>
                    <Button variant="secondary" disabled={!online} onClick={() => { setEditUser({ ...u }); setFormError(null) }}>تعديل</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : (
        <Banner tone="blue">إعدادات المبادرة وإدارة المنظمين للمالك فقط.</Banner>
      )}

      <Card>
        <h2 className="mb-3 font-bold text-brand-900">سجل التدقيق (آخر 100)</h2>
        {!audit ? <Spinner /> : audit.length === 0 ? <p className="text-sm text-brand-700">لا توجد أحداث.</p> : (
          <ul className="divide-y divide-brand-100 text-sm">
            {audit.map((a) => (
              <li key={a.id} className="py-2.5">
                <div className="font-semibold text-brand-900">{ACTION_AR[a.action] ?? a.action}</div>
                <div className="text-xs text-brand-700">
                  {formatDateTimeInTz(a.occurred_at, tz)} · {a.actor_id ? names[a.actor_id] ?? '—' : 'النظام'}
                </div>
                {a.action === 'attendance.void' && <div className="mt-0.5 text-xs text-red-800">السبب: {String(a.details.reason ?? '')}</div>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editUser && (
        <Modal title={editUser.isNew ? 'إضافة منظم' : 'تعديل منظم'} onClose={() => setEditUser(null)}>
          <form onSubmit={saveUser} className="space-y-4">
            {formError && <Banner tone="red">{formError}</Banner>}
            <Field label="البريد الإلكتروني" hint="يجب أن يكون الحساب منشأً في Supabase Auth.">
              <input className={inputClass} type="email" dir="ltr" required disabled={!editUser.isNew} value={editUser.email ?? ''} onChange={(e) => setEditUser({ ...editUser, email: e.target.value })} />
            </Field>
            <Field label="الاسم الظاهر"><input className={inputClass} required value={editUser.display_name ?? ''} onChange={(e) => setEditUser({ ...editUser, display_name: e.target.value })} /></Field>
            <Field label="الدور">
              <select className={inputClass} value={editUser.role} onChange={(e) => setEditUser({ ...editUser, role: e.target.value as Role })}>
                <option value="recorder">مسجِّل — تسجيل الحضور فقط</option>
                <option value="admin">مشرف — الأطفال والتقارير والإبطال</option>
                <option value="owner">مالك — كل شيء</option>
              </select>
            </Field>
            <label className="flex min-h-12 items-center gap-3">
              <input type="checkbox" className="h-5 w-5" checked={editUser.active ?? true} onChange={(e) => setEditUser({ ...editUser, active: e.target.checked })} />
              <span className="font-semibold text-brand-900">الحساب مُفعَّل</span>
            </label>
            <Button type="submit" block disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</Button>
          </form>
        </Modal>
      )}
    </div>
  )
}
