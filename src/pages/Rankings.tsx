import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PeriodPicker from '../components/PeriodPicker'
import { Badge, Banner, Card, Empty, PageTitle, Spinner } from '../components/ui'
import { useAppData } from '../lib/app-data'
import { fetchCounts } from '../lib/data'
import { errorToArabic } from '../lib/errors'
import { useOnline } from '../lib/hooks'
import { defaultPeriod, resolvePeriod, type PeriodState } from '../lib/periods'
import { rankParticipants, totalDays } from '../lib/ranking'
import type { RankedRow } from '../lib/types'

export default function Rankings() {
  const { today, campaign } = useAppData()
  const online = useOnline()
  const [period, setPeriod] = useState<PeriodState>(() => defaultPeriod(today, 'month'))
  const [rows, setRows] = useState<RankedRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const resolved = useMemo(
    () => (campaign ? resolvePeriod(period, campaign.start_date, today) : null),
    [period, campaign, today]
  )
  const fromKey = resolved?.range?.from
  const toKey = resolved?.range?.to

  useEffect(() => {
    if (!resolved?.range) {
      setRows([])
      return
    }
    if (!online) return
    let alive = true
    setLoading(true)
    setError(null)
    fetchCounts(resolved.range)
      .then((data) => {
        if (!alive) return
        setRows(rankParticipants(data.map((d) => ({ participantId: d.participant_id, name: d.name, active: d.active, days: d.days }))))
      })
      .catch((e) => alive && setError(errorToArabic(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromKey, toKey, online])

  if (!campaign) return <Banner tone="gold">لم تُعدَّ المبادرة بعد.</Banner>

  const withAttendance = rows?.filter((r) => r.rank !== null).length ?? 0

  return (
    <div className="space-y-4">
      <PageTitle title="الترتيب" subtitle="حسب عدد أيام الحضور الصالحة" />
      <PeriodPicker value={period} onChange={setPeriod} kinds={['month', 'quarter', 'all']} minDate={campaign.start_date} maxDate={today} />

      {resolved && (
        <Card className="bg-brand-50">
          <div className="font-bold text-brand-900">{resolved.title}</div>
          <div className="mt-0.5 text-sm text-brand-800">{resolved.note}</div>
          <p className="mt-2 text-xs leading-relaxed text-brand-700">
            الترتيب حسب عدد الأيام التي حضرها كل طفل في هذه الفترة. عند التعادل يأخذ المتساوون نفس المركز، ويُترك المركز التالي (مثال: 1، 1، 3). الأطفال بدون حضور في الفترة لا يُرتَّبون. اختيار الفائزين والجوائز قرار يدوي.
          </p>
        </Card>
      )}

      {!online && !rows && <Banner tone="blue">الترتيب يحتاج اتصالًا بالإنترنت.</Banner>}
      {error && <Banner tone="red">{error}</Banner>}
      {loading && <Spinner />}

      {resolved && !resolved.range && <Empty>{resolved.note}</Empty>}

      {rows && resolved?.range && !loading && (
        <>
          <div className="flex flex-wrap gap-2 text-sm text-brand-800">
            <Badge tone="green">{withAttendance} طفل حضر</Badge>
            <Badge tone="gray">إجمالي الحضور: {totalDays(rows)}</Badge>
          </div>
          {rows.length === 0 ? (
            <Empty>لا توجد بيانات</Empty>
          ) : (
            <ol className="space-y-2">
              {rows.map((r) => (
                <li key={r.participantId}>
                  <Link
                    to={`/participants/${r.participantId}`}
                    className={`flex min-h-14 items-center gap-3 rounded-2xl border px-4 py-3 active:bg-brand-50 ${
                      r.rank === 1 ? 'border-gold-400 bg-gold-100' : 'border-brand-100 bg-white'
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-extrabold ${
                        r.rank === 1 ? 'bg-gold-500 text-brand-900' : r.rank && r.rank <= 3 ? 'bg-brand-200 text-brand-900' : 'bg-brand-50 text-brand-700'
                      }`}
                    >
                      {r.rank ?? '—'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-brand-900">{r.name}</span>
                      {!r.active && <span className="text-xs text-brand-700">موقوف</span>}
                    </span>
                    <span className="shrink-0 text-end">
                      <span className="block text-xl font-extrabold text-brand-900">{r.days}</span>
                      <span className="block text-[11px] text-brand-700">يوم</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  )
}
