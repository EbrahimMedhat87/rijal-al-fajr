import { useMemo, useState } from 'react'
import PeriodPicker from '../components/PeriodPicker'
import { Banner, Button, Card, Chip, PageTitle, Spinner } from '../components/ui'
import { useAppData } from '../lib/app-data'
import { downloadCsv, toCsv } from '../lib/csv'
import { fetchAttendanceRange, fetchCounts, fetchProfileNames } from '../lib/data'
import { formatDateTimeInTz } from '../lib/dates'
import { errorToArabic } from '../lib/errors'
import { useOnline } from '../lib/hooks'
import { defaultPeriod, periodSlug, resolvePeriod, type PeriodState } from '../lib/periods'
import { rankParticipants } from '../lib/ranking'
import { db } from '../lib/db'

export default function Reports() {
  const { today, campaign, allMosques, mosqueName } = useAppData()
  const online = useOnline()
  const [period, setPeriod] = useState<PeriodState>(() => defaultPeriod(today, 'day'))
  const [busy, setBusy] = useState<'summary' | 'detail' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mosque, setMosque] = useState<string>('all')
  const [summary, setSummary] = useState<{ present: number; active: number; absent: string[] } | null>(null)

  const resolved = useMemo(() => (campaign ? resolvePeriod(period, campaign.start_date, today) : null), [period, campaign, today])
  if (!campaign) return <Banner tone="gold">لم تُعدَّ المبادرة بعد.</Banner>
  const tz = campaign.timezone
  const range = resolved?.range ?? null
  const slug = periodSlug(period)
  const mosqueId = mosque === 'all' ? null : mosque
  const activeMosques = allMosques.filter((m) => m.active)

  const exportSummary = async () => {
    if (!range) return
    setBusy('summary')
    setError(null)
    try {
      const counts = await fetchCounts(range, mosqueId)
      const ranked = rankParticipants(counts.map((c) => ({ participantId: c.participant_id, name: c.name, active: c.active, days: c.days, childNo: c.child_no, mosqueName: c.mosque_name })))
      const csv = toCsv(
        ['الترتيب', 'الرقم', 'الاسم', 'المسجد', 'عدد أيام الحضور', 'الحالة', 'من', 'إلى'],
        ranked.map((r) => [r.rank ?? '', r.childNo ?? '', r.name, r.mosqueName ?? '', r.days, r.active ? 'نشط' : 'موقوف', range.from, range.to])
      )
      downloadCsv(`rijal-al-fajr-summary-${slug}.csv`, csv)
    } catch (e) {
      setError(errorToArabic(e))
    } finally {
      setBusy(null)
    }
  }

  const exportDetail = async () => {
    if (!range) return
    setBusy('detail')
    setError(null)
    try {
      const [rows, names, parts] = await Promise.all([fetchAttendanceRange(range), fetchProfileNames(), db.participants.toArray()])
      const pn = new Map(parts.map((p) => [p.id, p]))
      const scopedRows = rows.filter((r) => !mosqueId || pn.get(r.participant_id)?.mosque_id === mosqueId)
      const csv = toCsv(
        ['التاريخ', 'الرقم', 'الاسم', 'المسجد', 'الحالة', 'سجّله', `وقت التسجيل (${tz})`, 'سبب الإبطال'],
        scopedRows.map((r) => [
          r.attendance_date,
          pn.get(r.participant_id)?.child_no ?? '',
          pn.get(r.participant_id)?.name ?? r.participant_id,
          mosqueName(pn.get(r.participant_id)?.mosque_id ?? ''),
          r.status === 'valid' ? 'صالح' : 'مُبطَل',
          names[r.recorded_by] ?? '',
          formatDateTimeInTz(r.recorded_at, tz),
          r.void_reason ?? ''
        ])
      )
      downloadCsv(`rijal-al-fajr-detail-${slug}.csv`, csv)
    } catch (e) {
      setError(errorToArabic(e))
    } finally {
      setBusy(null)
    }
  }

  const loadDaily = async () => {
    if (!range) return
    setBusy('summary')
    setError(null)
    try {
      const counts = await fetchCounts(range, mosqueId)
      const present = counts.filter((c) => c.days > 0)
      setSummary({
        present: present.length,
        active: counts.filter((c) => c.active).length,
        absent: counts.filter((c) => c.active && c.days === 0).map((c) => c.name).sort((a, b) => a.localeCompare(b, 'ar'))
      })
    } catch (e) {
      setError(errorToArabic(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <PageTitle title="التقارير" subtitle="ملخصات وتصدير CSV" />
      <PeriodPicker value={period} onChange={(p) => { setPeriod(p); setSummary(null) }} kinds={['day', 'month', 'quarter', 'all']} minDate={campaign.start_date} maxDate={today} />

      {activeMosques.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Chip active={mosque === 'all'} onClick={() => { setMosque('all'); setSummary(null) }}>كل المساجد</Chip>
          {activeMosques.map((m) => (
            <Chip key={m.id} active={mosque === m.id} onClick={() => { setMosque(m.id); setSummary(null) }}>{m.name}</Chip>
          ))}
        </div>
      )}

      {resolved && (
        <Card className="bg-brand-50">
          <div className="font-bold text-brand-900">{resolved.title}</div>
          <div className="mt-0.5 text-sm text-brand-800">{resolved.note}</div>
        </Card>
      )}

      {!online && <Banner tone="blue">التقارير والتصدير تحتاج اتصالًا بالإنترنت.</Banner>}
      {error && <Banner tone="red">{error}</Banner>}
      {!range && <Banner tone="gold">{resolved?.note}</Banner>}

      <Card className="space-y-3">
        <h2 className="font-bold text-brand-900">ملخص الفترة</h2>
        <Button variant="secondary" block disabled={!online || !range || busy !== null} onClick={() => void loadDaily()}>
          {busy === 'summary' ? 'جارٍ التحميل…' : 'عرض الملخص'}
        </Button>
        {busy === 'summary' && <Spinner />}
        {summary && (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-brand-700">أطفال حضروا (مرة على الأقل)</span><b className="text-brand-900">{summary.present}</b></div>
            <div className="flex justify-between"><span className="text-brand-700">الأطفال النشطون</span><b className="text-brand-900">{summary.active}</b></div>
            <div>
              <div className="mb-1 text-brand-700">نشطون لم يحضروا في هذه الفترة ({summary.absent.length})</div>
              {summary.absent.length === 0 ? <div className="text-brand-900">لا أحد 🎉</div> : <div className="leading-7 text-brand-900">{summary.absent.join('، ')}</div>}
            </div>
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-bold text-brand-900">تصدير CSV</h2>
        <Button block disabled={!online || !range || busy !== null} onClick={() => void exportSummary()}>
          {busy === 'summary' ? 'جارٍ التحضير…' : 'تصدير الترتيب (ملخص)'}
        </Button>
        <Button block variant="secondary" disabled={!online || !range || busy !== null} onClick={() => void exportDetail()}>
          {busy === 'detail' ? 'جارٍ التحضير…' : 'تصدير سجل الحضور (تفصيلي)'}
        </Button>
        <p className="text-xs text-brand-700">الملفات بترميز UTF-8 مع BOM، فتظهر العربية صحيحة في Excel وGoogle Sheets.</p>
      </Card>
    </div>
  )
}
