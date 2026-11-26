import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from './auth'
import { cachedCampaign, fetchCampaign, refreshAttendanceDate, refreshMosques, refreshParticipants } from './data'
import { DEFAULT_TZ, todayInTz } from './dates'
import { db, getMeta } from './db'
import { errorToArabic } from './errors'
import { useLive } from './hooks'
import type { Campaign, Mosque } from './types'

interface DataCtx {
  campaign: Campaign | null | undefined // undefined = جارٍ التحميل، null = لا توجد مبادرة
  today: string
  refreshAll(): Promise<void>
  refreshing: boolean
  refreshError: string | null
  /** كل المساجد (الأسماء يقرأها كل المنظمين) */
  allMosques: Mosque[]
  /** المساجد المتاحة لهذا المستخدم: المالك = الكل، غيره = المربوط بها */
  mosques: Mosque[]
  /** معرّف المسجد المختار أو 'all' */
  selectedMosque: string
  selectMosque(id: string): void
  mosqueName(id: string): string
}

const Ctx = createContext<DataCtx | null>(null)
const STORAGE_KEY = 'rf-selected-mosque'

function readStored(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? 'all'
  } catch {
    return 'all'
  }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth()
  const userId = state.status === 'ready' ? state.userId : ''
  const role = state.status === 'ready' ? state.profile.role : null

  const cached = useLive(() => cachedCampaign().then((c) => c ?? null))
  const mosqueRows = useLive(() => db.mosques.toArray())
  const myIds = useLive(() => getMeta<string[]>(db, 'myMosqueIds'))
  const tz = cached?.timezone ?? DEFAULT_TZ
  const [today, setToday] = useState(() => todayInTz(tz))
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [stored, setStored] = useState(readStored)
  const lastRun = useRef(0)
  const todayRef = useRef(today)
  todayRef.current = today

  const allMosques = useMemo(() => [...(mosqueRows ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'ar')), [mosqueRows])
  const mosques = useMemo(
    () => (role === 'owner' ? allMosques : allMosques.filter((m) => (myIds ?? []).includes(m.id))),
    [allMosques, myIds, role]
  )

  // المسجد المختار يجب أن يكون من المتاح؛ وإلا: لو مسجد واحد فهو، وإلا "الكل"
  const selectedMosque = useMemo(() => {
    if (stored !== 'all' && mosques.some((m) => m.id === stored)) return stored
    return mosques.length === 1 ? mosques[0].id : 'all'
  }, [stored, mosques])

  const selectMosque = useCallback((id: string) => {
    setStored(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      /* التخزين اختياري */
    }
  }, [])

  const mosqueName = useCallback((id: string) => allMosques.find((m) => m.id === id)?.name ?? '', [allMosques])

  // "اليوم" بتوقيت المبادرة، يُحدَّث دوريًا (يعبر منتصف الليل بدون إعادة فتح)
  useEffect(() => {
    const tick = () => setToday(todayInTz(tz))
    tick()
    const id = setInterval(tick, 20_000)
    return () => clearInterval(id)
  }, [tz])

  const refreshAll = useCallback(async () => {
    if (!navigator.onLine || !userId) return
    setRefreshing(true)
    try {
      await fetchCampaign()
      await refreshMosques(userId)
      await refreshParticipants()
      await refreshAttendanceDate(todayRef.current)
      setRefreshError(null)
      lastRun.current = Date.now()
    } catch (e) {
      setRefreshError(errorToArabic(e))
    } finally {
      setRefreshing(false)
    }
  }, [userId])

  useEffect(() => {
    void refreshAll()
    const onOnline = () => void refreshAll()
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRun.current > 60_000) void refreshAll()
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshAll])

  return (
    <Ctx.Provider
      value={{ campaign: cached, today, refreshAll, refreshing, refreshError, allMosques, mosques, selectedMosque, selectMosque, mosqueName }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useAppData(): DataCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('DataProvider missing')
  return c
}
