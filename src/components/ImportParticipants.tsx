import { useMemo, useRef, useState } from 'react'
import { Badge, Banner, Button, Field, Modal, inputClass } from './ui'
import { useAppData } from '../lib/app-data'
import { addParticipantsBulk, findSimilarChildren, transferChild, type SimilarChild } from '../lib/data'
import { useAllParticipants } from '../lib/participants'
import { errorToArabic } from '../lib/errors'
import { parseNameList, planImport, type ImportStatus } from '../lib/import'
import { useOnline } from '../lib/hooks'
import { useToast } from '../lib/toast'

const STATUS_LABEL: Record<ImportStatus, string> = {
  new: 'جديد',
  exists: 'موجود بالفعل',
  existsElsewhere: 'موجود في مسجد آخر',
  similarElsewhere: 'يشبه طفلًا في مسجد آخر',
  dupInList: 'مكرر في القائمة'
}

/** يقرأ ملف نصي/CSV. UTF-8 أولًا؛ لو ظهرت حروف تالفة (ملفات Excel القديمة) نجرّب windows-1256. */
async function readTextFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const utf8 = new TextDecoder('utf-8').decode(buf)
  if (!utf8.includes('�')) return utf8
  try {
    return new TextDecoder('windows-1256').decode(buf)
  } catch {
    return utf8
  }
}

export default function ImportParticipants({ defaultMosqueId, onClose }: { defaultMosqueId: string; onClose: () => void }) {
  const toast = useToast()
  const { mosques, mosqueName } = useAppData()
  const activeMosques = mosques.filter((m) => m.active)
  const existing = useAllParticipants()
  const online = useOnline()

  const [mosqueId, setMosqueId] = useState(defaultMosqueId)
  const [text, setText] = useState('')
  const [step, setStep] = useState<'input' | 'preview'>('input')
  const [skipped, setSkipped] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // نتائج مقارنة الخادم (المشرف لا يرى أطفال المساجد الأخرى محليًا): الاسم ← أول طفل مشابه
  const [serverMatches, setServerMatches] = useState<Map<string, SimilarChild>>(new Map())
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null)
  const [moved, setMoved] = useState<Set<number>>(new Set())
  const fileRef = useRef<HTMLInputElement>(null)

  const items = useMemo(() => {
    if (step !== 'preview') return []
    return planImport(parseNameList(text), existing ?? [], mosqueId, mosqueName).map((it) => {
      const m = it.status === 'new' ? serverMatches.get(it.name) : undefined
      return m ? { ...it, status: 'similarElsewhere' as const, otherMosque: m.mosque_name, similarTo: m.name, otherId: m.participant_id } : it
    })
  }, [step, text, existing, mosqueId, mosqueName, serverMatches])

  const goPreview = async () => {
    setError(null)
    setMoved(new Set())
    setConfirmIdx(null)
    const names = parseNameList(text)
    let matches = new Map<string, SimilarChild>()
    if (online) {
      setChecking(true)
      try {
        const rows = await findSimilarChildren(names, mosqueId)
        for (const r of rows) if (!matches.has(names[r.idx])) matches.set(names[r.idx], r)
      } catch {
        matches = new Map() // لا نمنع الاستيراد لو فشل الفحص؛ يبقى فحص الجهاز فقط
      } finally {
        setChecking(false)
      }
    }
    setServerMatches(matches)
    const parsed = planImport(names, existing ?? [], mosqueId, mosqueName)
    // الجديد فقط يُحدَّد تلقائيًا؛ الباقي يبقى مستبعدًا (ويمكن تحديده يدويًا)
    setSkipped(new Set(parsed.flatMap((p, i) => (p.status === 'new' && !matches.has(p.name) ? [] : [i]))))
    setStep('preview')
  }

  const doMove = async (i: number) => {
    const id = items[i]?.otherId
    if (!id) return
    setBusy(true)
    setError(null)
    try {
      await transferChild(id, mosqueId)
      setMoved((m) => new Set(m).add(i))
      setSkipped((s) => new Set(s).add(i))
      toast('success', `تم نقل ${items[i].similarTo ?? items[i].name} إلى ${mosqueName(mosqueId)} — سجل حضوره محفوظ`)
    } catch (e) {
      setError(errorToArabic(e))
    } finally {
      setConfirmIdx(null)
      setBusy(false)
    }
  }

  const onFile = async (f: File | undefined) => {
    if (!f) return
    if (f.size > 2_000_000) {
      setError('الملف كبير جدًا (الحد 2 ميجا).')
      return
    }
    setError(null)
    try {
      setText(await readTextFile(f))
    } catch {
      setError('تعذّرت قراءة الملف. جرّب ملف .txt أو .csv أو الصق الأسماء.')
    }
  }

  const chosen = items.filter((_, i) => !skipped.has(i))
  const count = chosen.length

  const submit = async () => {
    if (count === 0 || !mosqueId) return
    setBusy(true)
    setError(null)
    try {
      const n = await addParticipantsBulk(chosen.map((c) => c.name), mosqueId)
      toast('success', `تمت إضافة ${n} طفل إلى ${mosqueName(mosqueId)}`)
      onClose()
    } catch (e) {
      setError(errorToArabic(e) + ' — لو تمت إضافة جزء من القائمة فسيظهر كـ"موجود بالفعل" عند إعادة المحاولة.')
      setStep('preview')
    } finally {
      setBusy(false)
    }
  }

  const parsedCount = useMemo(() => parseNameList(text).length, [text])
  const newCount = items.filter((i) => i.status === 'new').length

  return (
    <Modal title="استيراد قائمة أسماء" onClose={onClose}>
      {step === 'input' ? (
        <div className="space-y-4">
          {error && <Banner tone="red">{error}</Banner>}
          {activeMosques.length > 1 ? (
            <Field label="المسجد الذي ستُضاف إليه الأسماء">
              <select className={inputClass} value={mosqueId} onChange={(e) => setMosqueId(e.target.value)}>
                {activeMosques.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </Field>
          ) : (
            <div className="text-sm font-semibold text-brand-800">🕌 {mosqueName(mosqueId)}</div>
          )}
          <Field label="الصق الأسماء (اسم في كل سطر)" hint="الأرقام التسلسلية وعلامات ✓ ✗ تُحذف تلقائيًا، وتقدر تلصق كشفًا كاملًا.">
            <textarea
              className={`${inputClass} min-h-48 leading-relaxed`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'أحمد محمد علي\nمحمود حسن إبراهيم\n…'}
              aria-label="قائمة الأسماء"
            />
          </Field>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.csv,text/plain,text/csv"
              className="hidden"
              onChange={(e) => {
                void onFile(e.target.files?.[0])
                e.target.value = ''
              }}
              aria-label="اختيار ملف"
            />
            <Button variant="secondary" block onClick={() => fileRef.current?.click()}>📄 أو اختر ملف (.txt / .csv)</Button>
          </div>
          <Button block disabled={parsedCount === 0 || !mosqueId || checking} onClick={() => void goPreview()}>
            {checking ? 'جارٍ فحص التكرار…' : parsedCount > 0 ? `معاينة (${parsedCount} اسم)` : 'معاينة'}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {error && <Banner tone="red">{error}</Banner>}
          <div className="text-sm font-semibold text-brand-800">🕌 {mosqueName(mosqueId)}</div>
          <p className="text-sm text-brand-700">
            {items.length} اسم: <b className="text-brand-900">{newCount} جديد</b>
            {items.length - newCount > 0 && <> · {items.length - newCount} مكرر/موجود (مستبعد تلقائيًا)</>}
          </p>
          <ul className="max-h-72 divide-y divide-brand-100 overflow-y-auto rounded-xl border border-brand-200" aria-label="معاينة الأسماء">
            {items.map((it, i) => (
              <li key={i}>
                <label className="flex min-h-12 items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    className="h-5 w-5 shrink-0"
                    checked={!skipped.has(i)}
                    onChange={(e) =>
                      setSkipped((s) => {
                        const n = new Set(s)
                        if (e.target.checked) n.delete(i)
                        else n.add(i)
                        return n
                      })
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-brand-900">{it.name}</span>
                    {it.status === 'existsElsewhere' && <span className="block text-xs text-brand-700">عند {it.otherMosque}</span>}
                    {it.status === 'similarElsewhere' && <span className="block text-xs text-brand-700">عند {it.otherMosque}: {it.similarTo}</span>}
                    {moved.has(i) && <span className="block text-xs font-semibold text-brand-800">✓ تم نقله إلى هذا المسجد</span>}
                    {online && it.otherId && !moved.has(i) && (it.status === 'existsElsewhere' || it.status === 'similarElsewhere') && (
                      confirmIdx === i ? (
                        <span className="mt-1 flex items-center gap-2">
                          <button type="button" disabled={busy} onClick={(e) => { e.preventDefault(); void doMove(i) }} className="min-h-9 rounded-lg bg-gold-500 px-3 text-xs font-bold text-brand-900">
                            {busy ? 'جارٍ النقل…' : `تأكيد: انقله من ${it.otherMosque}`}
                          </button>
                          <button type="button" disabled={busy} onClick={(e) => { e.preventDefault(); setConfirmIdx(null) }} className="min-h-9 px-2 text-xs text-brand-700">رجوع</button>
                        </span>
                      ) : (
                        <button type="button" onClick={(e) => { e.preventDefault(); setConfirmIdx(i) }} className="mt-1 min-h-9 rounded-lg border border-gold-400 bg-gold-100 px-3 text-xs font-bold text-brand-900">
                          نقله هنا بدل تكراره (يحتفظ بسجل حضوره)
                        </button>
                      )
                    )}
                  </span>
                  {it.status !== 'new' && <Badge tone={it.status === 'existsElsewhere' || it.status === 'similarElsewhere' ? 'blue' : 'gold'}>{STATUS_LABEL[it.status]}</Badge>}
                </label>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep('input')} disabled={busy}>رجوع</Button>
            <Button block disabled={busy || count === 0} onClick={() => void submit()}>
              {busy ? 'جارٍ الإضافة…' : count === 0 ? 'لا أسماء محددة' : `إضافة ${count} طفل`}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
