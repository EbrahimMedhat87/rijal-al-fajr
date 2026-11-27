import { useEffect, useMemo, useState, type FormEvent, useDeferredValue } from 'react'
import { Link } from 'react-router-dom'
import ImportParticipants from '../components/ImportParticipants'
import MosqueSwitcher from '../components/MosqueSwitcher'
import { Badge, Banner, Button, Card, Chip, ChildNo, Empty, Field, Modal, PageTitle, inputClass } from '../components/ui'
import { useAppData } from '../lib/app-data'
import { canManage, useSession } from '../lib/auth'
import { addParticipant, findSimilarChildren, transferChild, type SimilarChild } from '../lib/data'
import { findSimilarElsewhere } from '../lib/import'
import { useAllParticipants } from '../lib/participants'
import { useSync } from '../lib/sync-context'
import { errorToArabic } from '../lib/errors'
import { useOnline } from '../lib/hooks'
import { compareByNumberQuery, isNumericQuery, matchesQuery, normalizeArabic } from '../lib/text'
import { useToast } from '../lib/toast'

export default function Participants() {
  const session = useSession()
  const manage = canManage(session.profile.role)
  const online = useOnline()
  const toast = useToast()
  const { mosques, selectedMosque, mosqueName } = useAppData()
  const { engine, userId, syncNow } = useSync()
  const all = useAllParticipants()
  const [query, setQuery] = useState('')
  // البحث فوري (على الجهاز، بدون زر): نتائج كل حرف تظهر مباشرة، و useDeferredValue يمنع تقطيع الكتابة لو القائمة كبيرة
  const dq = useDeferredValue(query)
  const [showInactive, setShowInactive] = useState(false)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [name, setName] = useState('')
  const [mosqueId, setMosqueId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDup, setConfirmDup] = useState(false)
  const [serverSimilar, setServerSimilar] = useState<SimilarChild[] | null>(null)
  const [transferring, setTransferring] = useState<SimilarChild | null>(null)

  const activeMosques = mosques.filter((m) => m.active)
  const addMosque = mosqueId || (selectedMosque !== 'all' ? selectedMosque : activeMosques[0]?.id ?? '')
  const showMosque = selectedMosque === 'all' && mosques.length > 1

  const list = (all ?? [])
    .filter((p) => selectedMosque === 'all' || p.mosque_id === selectedMosque)
    .filter((p) => (showInactive ? true : p.active))
    .filter((p) => matchesQuery(p.name, dq, p.child_no))
    .sort((a, b) => (isNumericQuery(dq) ? compareByNumberQuery(dq, a, b) : 0) || a.name.localeCompare(b.name, 'ar'))

  const dupe = all?.find((p) => p.mosque_id === addMosque && normalizeArabic(p.name) === normalizeArabic(name))

  // تنبيه فوري: نفس أول 3 كلمات عند طفل في مسجد آخر
  // (المشرف لا يرى أطفال المساجد الأخرى، فنسأل الخادم؛ ولو لا إنترنت نكتفي بما على الجهاز)
  const localSimilar = useMemo<SimilarChild[]>(
    () =>
      all && name.trim() && addMosque
        ? findSimilarElsewhere(name, all, addMosque)
            .slice(0, 3)
            .map((s) => ({ idx: 0, participant_id: s.id, name: s.name, child_no: s.child_no ?? null, mosque_id: s.mosque_id, mosque_name: mosqueName(s.mosque_id) }))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, name, addMosque]
  )
  useEffect(() => {
    setServerSimilar(null)
    setTransferring(null)
    if (!adding || !online || !addMosque || normalizeArabic(name).split(' ').filter(Boolean).length < 2) return
    let alive = true
    const t = setTimeout(() => {
      findSimilarChildren([name], addMosque)
        .then((r) => alive && setServerSimilar(r))
        .catch(() => undefined)
    }, 350)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [adding, online, name, addMosque])
  const similar = serverSimilar ?? localSimilar

  const doTransfer = async (s: SimilarChild) => {
    setBusy(true)
    setError(null)
    try {
      await transferChild(s.participant_id, addMosque)
      toast('success', `تم نقل ${s.name} إلى ${mosqueName(addMosque)} — سجل حضوره محفوظ`)
      close()
    } catch (err) {
      setError(errorToArabic(err))
      setTransferring(null)
    } finally {
      setBusy(false)
    }
  }

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
      if (!navigator.onLine) throw new Error('offline')
      await addParticipant(name, addMosque)
      toast('success', 'تمت إضافة الطفل')
      close()
    } catch (err) {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message ?? ''
      if (!navigator.onLine || /^offline$|failed to fetch|network|load failed|timeout/i.test(msg)) {
        // بدون اتصال: نحفظ الطفل على الجهاز ويُرسَل تلقائيًا عند عودة الإنترنت
        await engine.enqueueChild(userId, name, addMosque)
        toast('success', `تمت إضافة ${name.trim()} على هذا الجهاز — سيُرسَل للخادم عند عودة الإنترنت`)
        close()
        if (navigator.onLine) void syncNow()
      } else {
        setError(errorToArabic(err))
      }
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
              <Button onClick={() => setAdding(true)} disabled={activeMosques.length === 0}>+ إضافة</Button>
            </div>
          ) : undefined
        }
      />
      <MosqueSwitcher />
      {manage && !online && <div className="mb-3"><Banner tone="blue">أنت بدون إنترنت: تقدر تضيف أطفالًا جددًا (يُرسَلون لاحقًا)، أما التعديل والاستيراد فيحتاجان اتصالًا.</Banner></div>}

      <div className="mb-3 space-y-2">
        <input type="search" className={inputClass} placeholder="ابحث بالاسم أو الرقم…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="بحث" enterKeyHint="done" onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
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
              {p.pending ? (
                <div className="flex min-h-14 items-center justify-between rounded-2xl border border-gold-300 bg-gold-50 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block truncate text-lg font-semibold text-brand-900">{p.name}</span>
                    {showMosque && <span className="block text-xs text-brand-700">{mosqueName(p.mosque_id)}</span>}
                  </span>
                  <Badge tone="gold">بانتظار الإرسال</Badge>
                </div>
              ) : (
                <Link to={`/participants/${p.id}`} className="flex min-h-14 items-center justify-between rounded-2xl border border-brand-200 bg-white px-4 py-3 active:bg-brand-50">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <ChildNo n={p.child_no} />
                      <span className="truncate text-lg font-semibold text-brand-900">{p.name}</span>
                    </span>
                    {showMosque && <span className="block text-xs text-brand-700">{mosqueName(p.mosque_id)}</span>}
                  </span>
                  {!p.active && <Badge tone="gray">موقوف</Badge>}
                </Link>
              )}
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
            {similar.length > 0 && (
              <Banner tone="gold">
                <b>تنبيه: الاسم ده غالبًا مكرر.</b> يوجد طفل بنفس بداية الاسم في مسجد آخر:
                <ul className="mt-2 space-y-2">
                  {similar.map((s) => (
                    <li key={s.participant_id} className="rounded-lg bg-white/70 p-2">
                      <div>
                        {s.child_no != null && <b dir="ltr">#{s.child_no} </b>}
                        {s.name} — <b>{s.mosque_name}</b>
                      </div>
                      {transferring?.participant_id === s.participant_id ? (
                        <div className="mt-2 space-y-2">
                          <div className="text-xs">هننقله من {s.mosque_name} إلى {mosqueName(addMosque)}، وسجل حضوره كله بيفضل معاه (وبياخد رقم جديد هنا).</div>
                          <div className="flex gap-2">
                            <Button variant="secondary" onClick={() => setTransferring(null)} disabled={busy}>رجوع</Button>
                            <Button variant="gold" block disabled={busy} onClick={() => void doTransfer(s)}>{busy ? 'جارٍ النقل…' : 'تأكيد النقل'}</Button>
                          </div>
                        </div>
                      ) : (
                        online && <Button variant="gold" className="mt-2 min-h-10 py-1.5 text-sm" onClick={() => setTransferring(s)}>نقله هنا بدل تكراره</Button>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 text-xs">لو هو نفس الطفل انقله (ما تضفوش مرة ثانية). ولو طفل آخر أكمل الإضافة.</div>
              </Banner>
            )}
            {confirmDup && dupe && (
              <Banner tone="gold">يوجد طفل بنفس الاسم "{dupe.name}". اضغط "إضافة رغم ذلك" لو كان طفلًا آخر.</Banner>
            )}
            <Button type="submit" block disabled={busy || !name.trim()}>
              {busy ? 'جارٍ الحفظ…' : confirmDup || similar.length > 0 ? 'إضافة رغم ذلك' : 'إضافة'}
            </Button>
          </form>
        </Modal>
      )}
      {!manage && <Card className="mt-4 text-xs text-brand-700">إضافة وتعديل الأطفال متاحة للمشرف والمالك فقط.</Card>}
    </div>
  )
}
