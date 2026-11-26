import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import ImportParticipants from '../components/ImportParticipants'
import MosqueSwitcher from '../components/MosqueSwitcher'
import { Badge, Banner, Button, Card, Chip, Empty, Field, Modal, PageTitle, inputClass } from '../components/ui'
import { useAppData } from '../lib/app-data'
import { canManage, useSession } from '../lib/auth'
import { addParticipant } from '../lib/data'
import { db } from '../lib/db'
import { errorToArabic } from '../lib/errors'
import { useLive, useOnline } from '../lib/hooks'
import { matchesQuery, normalizeArabic } from '../lib/text'
import { useToast } from '../lib/toast'

export default function Participants() {
  const session = useSession()
  const manage = canManage(session.profile.role)
  const online = useOnline()
  const toast = useToast()
  const { mosques, selectedMosque, mosqueName } = useAppData()
  const all = useLive(() => db.participants.toArray())
  const [query, setQuery] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [name, setName] = useState('')
  const [mosqueId, setMosqueId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDup, setConfirmDup] = useState(false)

  const activeMosques = mosques.filter((m) => m.active)
  const addMosque = mosqueId || (selectedMosque !== 'all' ? selectedMosque : activeMosques[0]?.id ?? '')
  const showMosque = selectedMosque === 'all' && mosques.length > 1

  const list = (all ?? [])
    .filter((p) => selectedMosque === 'all' || p.mosque_id === selectedMosque)
    .filter((p) => (showInactive ? true : p.active))
    .filter((p) => matchesQuery(p.name, query))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'))

  const dupe = all?.find((p) => p.mosque_id === addMosque && normalizeArabic(p.name) === normalizeArabic(name))

  const close = () => {
    setAdding(false)
    setName('')
    setMosqueId('')
    setError(null)
    setConfirmDup(false)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !addMosque) return
    if (dupe && !confirmDup) {
      setConfirmDup(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await addParticipant(name, addMosque)
      toast('success', 'تمت إضافة الطفل')
      close()
    } catch (err) {
      setError(errorToArabic(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageTitle
        title="الأطفال"
        subtitle={all ? `${list.filter((p) => p.active).length} نشط` : undefined}
        action={
          manage ? (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setImporting(true)} disabled={!online || activeMosques.length === 0}>📥 استيراد</Button>
              <Button onClick={() => setAdding(true)} disabled={!online || activeMosques.length === 0}>+ إضافة</Button>
            </div>
          ) : undefined
        }
      />
      <MosqueSwitcher />
      {manage && !online && <div className="mb-3"><Banner tone="blue">إضافة وتعديل الأطفال تحتاج اتصالًا بالإنترنت.</Banner></div>}

      <div className="mb-3 space-y-2">
        <input type="search" className={inputClass} placeholder="ابحث بالاسم…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="بحث" />
        {manage && (
          <div className="flex gap-2">
            <Chip active={!showInactive} onClick={() => setShowInactive(false)}>النشطون</Chip>
            <Chip active={showInactive} onClick={() => setShowInactive(true)}>الكل (مع الموقوفين)</Chip>
          </div>
        )}
      </div>

      {list.length === 0 ? (
        <Empty>{query ? 'لا توجد نتائج' : 'لا يوجد أطفال بعد'}</Empty>
      ) : (
        <ul className="space-y-2">
          {list.map((p) => (
            <li key={p.id}>
              <Link to={`/participants/${p.id}`} className="flex min-h-14 items-center justify-between rounded-2xl border border-brand-200 bg-white px-4 py-3 active:bg-brand-50">
                <span className="min-w-0">
                  <span className="block truncate text-lg font-semibold text-brand-900">{p.name}</span>
                  {showMosque && <span className="block text-xs text-brand-700">{mosqueName(p.mosque_id)}</span>}
                </span>
                {!p.active && <Badge tone="gray">موقوف</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {importing && <ImportParticipants defaultMosqueId={addMosque} onClose={() => setImporting(false)} />}
      {adding && (
        <Modal title="إضافة طفل" onClose={close}>
          <form onSubmit={submit} className="space-y-4">
            {error && <Banner tone="red">{error}</Banner>}
            {activeMosques.length > 1 ? (
              <Field label="المسجد">
                <select className={inputClass} value={addMosque} onChange={(e) => { setMosqueId(e.target.value); setConfirmDup(false) }}>
                  {activeMosques.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </Field>
            ) : (
              <div className="text-sm font-semibold text-brand-800">🕌 {mosqueName(addMosque)}</div>
            )}
            <Field label="اسم الطفل" hint="الاسم فقط — لا نجمع أي بيانات أخرى. لو تشابهت الأسماء أضف حرفًا مميزًا (مثال: محمد أحمد - ع).">
              <input className={inputClass} value={name} maxLength={100} autoFocus required onChange={(e) => { setName(e.target.value); setConfirmDup(false) }} />
            </Field>
            {confirmDup && dupe && (
              <Banner tone="gold">يوجد طفل بنفس الاسم "{dupe.name}". اضغط "إضافة رغم ذلك" لو كان طفلًا آخر.</Banner>
            )}
            <Button type="submit" block disabled={busy || !name.trim()}>
              {busy ? 'جارٍ الحفظ…' : confirmDup ? 'إضافة رغم ذلك' : 'إضافة'}
            </Button>
          </form>
        </Modal>
      )}
      {!manage && <Card className="mt-4 text-xs text-brand-700">إضافة وتعديل الأطفال متاحة للمشرف والمالك فقط.</Card>}
    </div>
  )
}
