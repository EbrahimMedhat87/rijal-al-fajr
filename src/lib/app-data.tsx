import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { cachedCampaign, fetchCampaign, refreshAttendanceDate, refreshParticipants } from './data'
import { DEFAULT_TZ, todayInTz } from './dates'
import { useLive } from './hooks'
import { errorToArabic } from './errors'
import type { Campaign } from './types'

interface DataCtx {
  campaign: Campaign | null | undefined // undefined = جارٍ التحميل، null = لا توجد مبادرة
  today: string
  refreshAll(): Promise<void>
  refreshing: boolean
  refreshError: string | null
}

const Ctx = createContext<DataCtx | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const cached = useLive(() => cachedCampaign().then((c) => c ?? null))
  const tz = cached?.timezone ?? DEFAULT_TZ
  const [today, setToday] = useState(() => todayInTz(tz))
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const lastRun = useRef(0)
  const todayRef = useRef(today)
  todayRef.current = today

  // "اليوم" بتوقيت المبادرة، يُحدَّث دوريًا (يعبر منتصف الليل بدون إعادة فتح)
  useEffect(() => {
    const tick = () => setToday(todayInTz(tz))
    tick()
    const id = setInterval(tick, 20_000)
    return () => clearInterval(id)
  }, [tz])

  const refreshAll = useCallback(async () => {
    if (!navigator.onLine) return
    setRefreshing(true)
    try {
      await fetchCampaign()
      await refreshParticipants()
      await refreshAttendanceDate(todayRef.current)
      setRefreshError(null)
      lastRun.current = Date.now()
    } catch (e) {
      setRefreshError(errorToArabic(e))
    } finally {
      setRefreshing(false)
    }
  }, [])

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

  return <Ctx.Provider value={{ campaign: cached, today, refreshAll, refreshing, refreshError }}>{children}</Ctx.Provider>
}

export function useAppData(): DataCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('DataProvider missing')
  return c
}
