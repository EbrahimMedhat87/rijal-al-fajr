import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PeriodPicker from '../components/PeriodPicker'
import { Badge, Banner, Card, Chip, Empty, PageTitle, Spinner } from '../components/ui'
import { useAppData } from '../lib/app-data'
import { fetchCounts, fetchMosqueRanking } from '../lib/data'
import { errorToArabic } from '../lib/errors'
import { useOnline } from '../lib/hooks'
import { defaultPeriod, resolvePeriod, type PeriodState } from '../lib/periods'
import { rankMosques, rankParticipants, totalDays, type RankedMosque } from '../lib/ranking'
import type { RankedRow } from '../lib/types'

type Tab = 'children' | 'mosques'

export default function Rankings() {
  const { today, campaign, allMosques } = useAppData()
  const online = useOnline()
  const [tab, setTab] = useState<Tab>('children')
  const [mosqueFilter, setMosqueFilter] = useState<string>('all')
  const [period, setPeriod] = useState<PeriodState>(() => defaultPeriod(today, 'month'))
  const [rows, setRows] = useState<RankedRow[] | null>(null)
  const [mosqueRows, setMosqueRows] = useState<RankedMosque[] | null>(null)
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
      setMosqueRows([])
      return
    }
    if (!online) return
    let alive = true
    setLoading(true)
    setError(null)
    const range = resolved.range
    const job =
      tab === 'children'
        ? fetchCounts(range, mosqueFilter === 'all' ? null : mosqueFilter).then((data) => {
            if (!alive) return
            setRows(
              rankParticipants(
                data.map((d) => ({ participantId: d.participant_id, name: d.name, active: d.active, days: d.days, mosqueName: d.mosque_name }))
              )
            )
          })
        : fetchMosqueRanking(range).then((data) => {
            if (!alive) return
            setMosqueRows(
              rankMosques(
                data.map((d) => ({ mosqueId: d.mosque_id, name: d.name, children: d.children, present: d.present, totalDays: d.total_days, avgDays: d.avg_days }))
              )
            )
          })
    job.catch((e) => alive && setError(errorToArabic(e))).finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromKey, toKey, online, tab, mosqueFilter])

  if (!campaign) return <Banner tone="gold">لم تُعدَّ المبادرة بعد.</Banner>

  const withAttendance = rows?.filter((r) => r.rank !== null).length ?? 0
  const activeMosques = allMosques.filter((m) => m.active)

  return (
    <div className="space-y-4">
      <PageTitle title="الترتيب" subtitle="حسب عدد أيام الحضور الصالحة" />

      <div className="flex gap-2" role="tablist">
        <Chip active={tab === 'children'} onClick={() => setTab('children')}>ترتيب الأطفال</Chip>
        <Chip active={tab === 'mosques'} onClick={() => setTab('mosques')}>ترتيب المساجد</Chip>
      </div>

      <PeriodPicker value={period} onChange={setPeriod} kinds={['month', 'quarter', 'all']} minDate={campaign.start_date} maxDate={today} />

      {tab === 'children' && activeMosques.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Chip active={mosqueFilter === 'all'} onClick={() => setMosqueFilter('all')}>كل المساجد</Chip>
          {activeMosques.map((m) => (
            <Chip key={m.id} active={mosqueFilter === m.id} onClick={() => setMosqueFilter(m.id)}>{m.name}</Chip>
          ))}
        </div>
      )}

      {resolved && (
        <Card className="bg-brand-50">
          <div className="font-bold text-brand-900">{resolved.title}</div>
          <div className="mt-0.5 text-sm text-brand-800">{resolved.note}</div>
          <p className="mt-2 text-xs leading-relaxed text-brand-700">
            {tab === 'children'
              ? 'الترتيب حسب عدد الأيام التي حضرها كل طفل في هذه الفترة. عند التعادل يأخذ المتساوون نفس المركز ويُترك المركز التالي (مثال: 1، 1، 3). الأطفال بدون حضور في الفترة لا يُرتَّبون. اختيار الفائزين والجوائز قرار يدوي.'
              : 'ترتيب المساجد بمتوسط أيام الحضور للطفل الواحد (إجمالي أيام الحضور ÷ عدد الأطفال)، حتى لا يتفوق مسجد لمجرد أن عدد أطفاله أكبر. التعادل بنفس المركز، والمسجد بلا حضور لا يُرتَّب.'}
          </p>
        </Card>
      )}

      {!online && !(tab === 'children' ? rows : mosqueRows) && <Banner tone="blue">الترتيب يحتاج اتصالًا بالإنترنت.</Banner>}
      {error && <Banner tone="red">{error}</Banner>}
      {loading && <Spinner />}
      {resolved && !resolved.range && <Empty>{resolved.note}</Empty>}

      {tab === 'children' && rows && resolved?.range && !loading && (
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
                    <RankBubble rank={r.rank} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-brand-900">{r.name}</span>
                      <span className="block truncate text-xs text-brand-700">
                        {r.mosqueName}
                        {!r.active && ' · موقوف'}
                      </span>
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

      {tab === 'mosques' && mosqueRows && resolved?.range && !loading && (
        <>
          {mosqueRows.length === 0 ? (
            <Empty>لا توجد مساجد</Empty>
          ) : (
            <ol className="space-y-2">
              {mosqueRows.map((r) => (
                <li
                  key={r.mosqueId}
                  className={`flex min-h-14 items-center gap-3 rounded-2xl border px-4 py-3 ${
                    r.rank === 1 ? 'border-gold-400 bg-gold-100' : 'border-brand-100 bg-white'
                  }`}
                >
                  <RankBubble rank={r.rank} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-brand-900">{r.name}</span>
                    <span className="block text-xs text-brand-700">
                      {r.children} طفل · حضر {r.present} · إجمالي {r.totalDays} يوم
                    </span>
                  </span>
                  <span className="shrink-0 text-end">
                    <span className="block text-xl font-extrabold text-brand-900">{r.avgDays.toFixed(2)}</span>
                    <span className="block text-[11px] text-brand-700">يوم/طفل</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  )
}

function RankBubble({ rank }: { rank: number | null }) {
  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-extrabold ${
        rank === 1 ? 'bg-gold-500 text-brand-900' : rank && rank <= 3 ? 'bg-brand-200 text-brand-900' : 'bg-brand-50 text-brand-700'
      }`}
    >
      {rank ?? '—'}
    </span>
  )
}
