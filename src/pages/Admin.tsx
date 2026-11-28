import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Badge, Banner, Button, Card, Field, Modal, PageTitle, Spinner, inputClass } from '../components/ui'
import { useAppData } from '../lib/app-data'
import { canManage, useSession } from '../lib/auth'
import { createMosque, deleteMosqueChildren, fetchAudit, fetchProfileNames, listPendingUsers, listUsers, previewMosqueChildrenDelete, refreshMosques, rejectSignup, removeUser, setUserMosques, updateCampaign, updateMosque, upsertUser, type AuditRow, type MosqueDeletePreview, type PendingUser, type UserRow } from '../lib/data'
import { formatDateTimeInTz } from '../lib/dates'
import { errorToArabic } from '../lib/errors'
import { useOnline } from '../lib/hooks'
import { normalizeArabic } from '../lib/text'
import { useToast } from '../lib/toast'
import type { Role } from '../lib/types'

const ROLE_AR: Record<Role, string> = { owner: 'مالك', admin: 'مشرف', recorder: 'مسجِّل' }
const ACTION_AR: Record<string, string> = {
  'attendance.void': 'إبطال حضور',
  'participant.delete': 'حذف طفل نهائيًا',
  'participant.transfer': 'نقل طفل لمسجد آخر',
  'mosque.delete_children': 'حذف كل أطفال مسجد',
  'user.remove': 'إزالة منظم/مشرف',
  'participants.insert': 'إضافة طفل',
  'participants.update': 'تعديل طفل',
  'profiles.insert': 'إضافة منظم',
  'profiles.update': 'تعديل منظم',
  'profiles.delete': 'حذف منظم',
  'campaigns.insert': 'إنشاء المبادرة',
  'campaigns.update': 'تعديل إعدادات المبادرة',
  'mosques.insert': 'إضافة مسجد',
  'mosques.update': 'تعديل مسجد',
  'user_mosques.insert': 'ربط منظم بمسجد',
  'user_mosques.delete': 'فك ربط منظم بمسجد'
}

export default function Admin() {
  const session = useSession()
  const { campaign, allMosques } = useAppData()
  const online = useOnline()
  const toast = useToast()
  const isOwner = session.profile.role === 'owner'

  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [pending, setPending] = useState<PendingUser[] | null>(null)
  const [audit, setAudit] = useState<AuditRow[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [editUser, setEditUser] = useState<Partial<UserRow> & { isNew?: boolean } | null>(null)
  const [editMosque, setEditMosque] = useState<{ id?: string; name: string; active: boolean } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [delMosque, setDelMosque] = useState<{ id: string; name: string; preview: MosqueDeletePreview | null; confirm: string } | null>(null)
  const [removing, setRemoving] = useState<UserRow | null>(null)
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
      if (isOwner) {
        const [u, p] = await Promise.all([listUsers(), listPendingUsers()])
        setUsers(u)
        setPending(p)
      }
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
      const id = await upsertUser(editUser.email ?? '', editUser.display_name ?? '', (editUser.role ?? 'recorder') as Role, editUser.active ?? true)
      await setUserMosques(id, editUser.mosque_ids ?? [])
      toast('success', 'تم حفظ المنظم')
      setEditUser(null)
      await load()
    } catch (err) {
      setFormError(errorToArabic(err))
    } finally {
      setBusy(false)
    }
  }

  const approve = (p: PendingUser) => {
    const req = normalizeArabic(p.requested_mosque ?? '')
    const guess = req ? allMosques.filter((m) => req.includes(normalizeArabic(m.name)) || normalizeArabic(m.name).includes(req)).map((m) => m.id) : []
    setEditUser({ isNew: true, email: p.email, display_name: p.full_name ?? '', role: 'admin', active: true, mosque_ids: guess })
    setFormError(null)
  }

  const reject = async (p: PendingUser) => {
    if (!window.confirm(`رفض وحذف طلب ${p.full_name ?? p.email}؟`)) return
    try {
      await rejectSignup(p.user_id)
      toast('success', 'تم حذف الطلب')
      await load()
    } catch (err) {
      setError(errorToArabic(err))
    }
  }

  const saveMosque = async (e: FormEvent) => {
    e.preventDefault()
    if (!editMosque) return
    setBusy(true)
    setFormError(null)
    try {
      if (editMosque.id) await updateMosque(editMosque.id, { name: editMosque.name, active: editMosque.active })
      else await createMosque(editMosque.name)
      await refreshMosques(session.userId)
      toast('success', 'تم حفظ المسجد')
      setEditMosque(null)
      await load()
    } catch (err) {
      setFormError(errorToArabic(err))
    } finally {
      setBusy(false)
    }
  }

  const openDelMosque = async (id: string, name: string) => {
    setDelMosque({ id, name, preview: null, confirm: '' })
    setFormError(null)
    try {
      const preview = await previewMosqueChildrenDelete(id)
      setDelMosque((d) => (d && d.id === id ? { ...d, preview } : d))
    } catch (err) {
      setFormError(errorToArabic(err))
    }
  }

  const doDelMosque = async (e: FormEvent) => {
    e.preventDefault()
    if (!delMosque) return
    setBusy(true)
    setFormError(null)
    try {
      const r = await deleteMosqueChildren(delMosque.id, delMosque.confirm)
      toast('success', `تم حذف ${r.children} طفل من ${r.mosque}`)
      setDelMosque(null)
      await load()
    } catch (err) {
      setFormError(errorToArabic(err))
    } finally {
      setBusy(false)
    }
  }

  const doRemoveUser = async () => {
    if (!removing) return
    setBusy(true)
    setFormError(null)
    try {
      const st = await removeUser(removing.user_id)
      toast('success', st === 'deleted' ? `تم حذف ${removing.display_name} نهائيًا` : `تم إيقاف ${removing.display_name} (عنده سجلات فمتحذفش)`)
      setRemoving(null)
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
          {pending && pending.length > 0 && (
            <Card className="border-gold-400">
              <h2 className="mb-1 font-bold text-brand-900">طلبات تسجيل جديدة ({pending.length})</h2>
              <p className="mb-3 text-xs leading-relaxed text-brand-700">دول أشخاص أنشأوا حسابات ولسه مش شايفين أي بيانات. اضغط "قبول" لتحديد دورهم ومسجدهم.</p>
              <ul className="divide-y divide-brand-100">
                {pending.map((p) => (
                  <li key={p.user_id} className="py-3">
                    <div className="font-semibold text-brand-900">{p.full_name ?? '—'}</div>
                    <div className="truncate text-xs text-brand-700" dir="ltr">{p.email}</div>
                    {p.requested_mosque && <div className="mt-1 text-xs text-brand-800">🕌 قال إنه في: {p.requested_mosque}</div>}
                    <div className="mt-2 flex gap-2">
                      <Button disabled={!online} onClick={() => approve(p)}>قبول</Button>
                      <Button variant="secondary" disabled={!online} onClick={() => void reject(p)}>رفض</Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

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
              <h2 className="font-bold text-brand-900">المساجد</h2>
              <Button variant="secondary" disabled={!online} onClick={() => { setEditMosque({ name: '', active: true }); setFormError(null) }}>+ إضافة</Button>
            </div>
            {allMosques.length === 0 ? (
              <p className="text-sm text-brand-700">لا توجد مساجد. أضف المساجد أولًا، ثم اربط كل منظم بمسجده، ثم أضف الأطفال لكل مسجد.</p>
            ) : (
              <ul className="divide-y divide-brand-100">
                {allMosques.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-brand-900">🕌 {m.name}</div>
                      {!m.active && <Badge tone="red">موقوف</Badge>}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button variant="secondary" disabled={!online} onClick={() => { setEditMosque({ id: m.id, name: m.name, active: m.active }); setFormError(null) }}>تعديل</Button>
                      <Button variant="danger" disabled={!online} aria-label={`حذف كل أطفال ${m.name}`} onClick={() => void openDelMosque(m.id, m.name)}>🗑 الأطفال</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold text-brand-900">المنظمون</h2>
              <Button variant="secondary" disabled={!online} onClick={() => { setEditUser({ isNew: true, role: 'recorder', active: true, mosque_ids: [] }); setFormError(null) }}>+ إضافة</Button>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-brand-700">
              المنظم الجديد ينشئ حسابه بنفسه من شاشة الدخول ("منظم جديد؟ أنشئ حسابك")، فيظهر لك في "طلبات تسجيل جديدة" أعلاه لتقبله وتربطه بمسجده.
            </p>
            {!users ? <Spinner /> : (
              <ul className="divide-y divide-brand-100">
                {users.map((u) => (
                  <li key={u.user_id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-brand-900">{u.display_name}</div>
                      <div className="truncate text-xs text-brand-700" dir="ltr">{u.email}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge tone="green">{ROLE_AR[u.role]}</Badge>
                        {!u.active && <Badge tone="red">موقوف</Badge>}
                        {u.role === 'owner' ? <Badge tone="blue">كل المساجد</Badge> : u.mosque_ids.length === 0 ? <Badge tone="gold">بدون مسجد</Badge> : u.mosque_ids.map((id) => <Badge key={id} tone="blue">{allMosques.find((m) => m.id === id)?.name ?? '—'}</Badge>)}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      <Button variant="secondary" disabled={!online} onClick={() => { setEditUser({ ...u }); setFormError(null) }}>تعديل</Button>
                      {u.role !== 'owner' && u.user_id !== session.userId && (
                        <Button variant="danger" disabled={!online} aria-label={`إزالة ${u.display_name}`} onClick={() => { setRemoving(u); setFormError(null) }}>إزالة</Button>
                      )}
                    </div>
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

      {delMosque && (
        <Modal title="حذف كل أطفال المسجد" onClose={() => !busy && setDelMosque(null)}>
          <form onSubmit={doDelMosque} className="space-y-4">
            {formError && <Banner tone="red">{formError}</Banner>}
            {!delMosque.preview ? <Spinner /> : (
              <>
                <Banner tone="red">
                  هيتحذف <b>{delMosque.preview.children}</b> طفل من <b>{delMosque.name}</b> مع <b>{delMosque.preview.attendance_valid + delMosque.preview.attendance_void}</b> سجل حضور، وهيختفوا من الترتيب والتقارير. <b>مفيش رجوع من التطبيق</b> (البيانات بتتحفظ في سجل التدقيق بس). المسجد نفسه والمشرفين مش هيتأثروا، والترقيم هيبدأ من 1 تاني.
                </Banner>
                <Field label={`اكتب اسم المسجد "${delMosque.name}" للتأكيد`}>
                  <input className={inputClass} autoFocus value={delMosque.confirm} onChange={(e) => setDelMosque({ ...delMosque, confirm: e.target.value })} />
                </Field>
                <Button type="submit" variant="danger" block disabled={busy || !online || delMosque.confirm.trim() !== delMosque.name.trim() || delMosque.preview.children === 0}>
                  {busy ? 'جارٍ الحذف…' : delMosque.preview.children === 0 ? 'المسجد فاضي' : 'احذف كل الأطفال نهائيًا'}
                </Button>
              </>
            )}
          </form>
        </Modal>
      )}

      {removing && (
        <Modal title="إزالة منظم" onClose={() => !busy && setRemoving(null)}>
          <div className="space-y-4">
            {formError && <Banner tone="red">{formError}</Banner>}
            <p className="text-sm leading-relaxed text-brand-900">
              هتتشال <b>{removing.display_name}</b> من التطبيق ومش هيعرف يدخل تاني. لو هو سجّل حضور أو أضاف أطفال قبل كده، حسابه بيتوقف بس (عشان السجلات متضيعش)، ولو معندوش أي سجل بيتحذف خالص.
            </p>
            <Button variant="danger" block disabled={busy || !online} onClick={() => void doRemoveUser()}>{busy ? 'جارٍ الإزالة…' : 'أيوه، أزِله'}</Button>
            <Button variant="secondary" block disabled={busy} onClick={() => setRemoving(null)}>إلغاء</Button>
          </div>
        </Modal>
      )}

      {editMosque && (
        <Modal title={editMosque.id ? 'تعديل مسجد' : 'إضافة مسجد'} onClose={() => setEditMosque(null)}>
          <form onSubmit={saveMosque} className="space-y-4">
            {formError && <Banner tone="red">{formError}</Banner>}
            <Field label="اسم المسجد">
              <input className={inputClass} required maxLength={100} autoFocus value={editMosque.name} onChange={(e) => setEditMosque({ ...editMosque, name: e.target.value })} />
            </Field>
            {editMosque.id && (
              <label className="flex min-h-12 items-center gap-3">
                <input type="checkbox" className="h-5 w-5" checked={editMosque.active} onChange={(e) => setEditMosque({ ...editMosque, active: e.target.checked })} />
                <span className="font-semibold text-brand-900">المسجد نشط</span>
              </label>
            )}
            <Button type="submit" block disabled={busy || !editMosque.name.trim()}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</Button>
          </form>
        </Modal>
      )}

      {editUser && (
        <Modal title={editUser.isNew ? 'إضافة منظم' : 'تعديل منظم'} onClose={() => setEditUser(null)}>
          <form onSubmit={saveUser} className="space-y-4">
            {formError && <Banner tone="red">{formError}</Banner>}
            <Field label="البريد الإلكتروني" hint="لازم يكون المنظم أنشأ حسابه من شاشة الدخول.">
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
            {editUser.role === 'owner' ? (
              <p className="text-xs text-brand-700">المالك يرى كل المساجد تلقائيًا.</p>
            ) : (
              <fieldset>
                <legend className="mb-1.5 text-sm font-semibold text-brand-900">المساجد المربوط بها</legend>
                {allMosques.length === 0 && <p className="text-xs text-brand-700">أضف المساجد أولًا.</p>}
                {allMosques.map((m) => {
                  const on = (editUser.mosque_ids ?? []).includes(m.id)
                  return (
                    <label key={m.id} className="flex min-h-11 items-center gap-3">
                      <input
                        type="checkbox"
                        className="h-5 w-5"
                        checked={on}
                        onChange={(e) => setEditUser({ ...editUser, mosque_ids: e.target.checked ? [...(editUser.mosque_ids ?? []), m.id] : (editUser.mosque_ids ?? []).filter((x) => x !== m.id) })}
                      />
                      <span className="text-brand-900">{m.name}</span>
                    </label>
                  )
                })}
                {allMosques.length > 0 && (editUser.mosque_ids ?? []).length === 0 && (
                  <p className="mt-1 text-xs text-red-800">بدون مسجد لن يرى هذا المنظم أي أطفال.</p>
                )}
              </fieldset>
            )}
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
