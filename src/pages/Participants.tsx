import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Banner, Button, Card, Chip, Empty, Field, Modal, PageTitle, inputClass } from '../components/ui'
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
  const all = useLive(() => db.participants.toArray())
  const [query, setQuery] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDup, setConfirmDup] = useState(false)

  const list = (all ?? [])
    .filter((p) => (showInactive ? true : p.active))
    .filter((p) => matchesQuery(p.name, query))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'))

  const dupe = all?.find((p) => normalizeArabic(p.name) === normalizeArabic(name))

  const close = () => {
    setAdding(false)
    setName('')
    setError(null)
    setConfirmDup(false)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    if (dupe && !confirmDup) {
      setConfirmDup(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await addParticipant(name)
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
        subtitle={all ? `${all.filter((p) => p.active).length} نشط` : undefined}
        action={manage ? <Button onClick={() => setAdding(true)} disabled={!online}>+ إضافة</Button> : undefined}
      />
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
                <span className="text-lg font-semibold text-brand-900">{p.name}</span>
                {!p.active && <Badge tone="gray">موقوف</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <Modal title="إضافة طفل" onClose={close}>
          <form onSubmit={submit} className="space-y-4">
            {error && <Banner tone="red">{error}</Banner>}
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
