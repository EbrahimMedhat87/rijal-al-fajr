import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAppData } from './app-data'
import { useAuth } from './auth'
import { createSupabaseBackend } from './backend'
import { refreshAttendanceDate } from './data'
import { db } from './db'
import { arabicError } from './errors'
import { useLive } from './hooks'
import { supabase } from './supabase'
import { SyncEngine } from './sync'
import { useToast } from './toast'

interface SyncCtx {
  engine: SyncEngine
  userId: string
  syncNow(): Promise<void>
  syncing: boolean
  pendingCount: number
  failedCount: number
  otherUsersPending: number
  lastError: string | null
  lastSyncAt: number | null
}

const Ctx = createContext<SyncCtx | null>(null)
const SEVEN_DAYS = 7 * 24 * 3600 * 1000

export function SyncProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth()
  const { today } = useAppData()
  const toast = useToast()
  const engine = useMemo(() => new SyncEngine(db, createSupabaseBackend(supabase)), [])
  const [syncing, setSyncing] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const userId = state.status === 'ready' ? state.userId : ''

  const counts = useLive(async () => {
    const all = await db.queue.toArray()
    const mine = all.filter((o) => o.userId === userId)
    return {
      pending: mine.filter((o) => o.status === 'pending' || o.status === 'syncing').length,
      failed: mine.filter((o) => o.status === 'failed').length,
      others: all.filter((o) => o.userId !== userId && (o.status === 'pending' || o.status === 'syncing')).length
    }
  }, [userId])

  const busy = useRef(false)
  const todayRef = useRef(today)
  todayRef.current = today

  const syncNow = useCallback(async () => {
    if (!userId || busy.current) return
    if (!navigator.onLine) {
      setLastError(arabicError('NETWORK'))
      return
    }
    busy.current = true
    setSyncing(true)
    try {
      const s = await engine.syncAll(userId)
      if (s.stoppedByTransientError) {
        setLastError(arabicError(s.lastErrorCode))
      } else {
        setLastError(null)
        setLastSyncAt(Date.now())
      }
      if (s.alreadyRecorded > 0) {
        toast('info', s.alreadyRecorded === 1 ? 'تم تسجيل حضور طفل مسبقًا من جهاز آخر — لا تكرار' : `تم تسجيل حضور ${s.alreadyRecorded} أطفال مسبقًا من أجهزة أخرى — لا تكرار`)
      }
      if (s.failed > 0) toast('error', `${s.failed} سجل لم يُقبَل من الخادم — راجع قائمة "فشل" في الصفحة الرئيسية`)
      if (s.sent > 0) refreshAttendanceDate(todayRef.current).catch(() => {})
    } finally {
      busy.current = false
      setSyncing(false)
    }
  }, [engine, userId, toast])

  // مزامنة تلقائية: عند الفتح، عودة الاتصال، العودة للتطبيق، وكل 20 ثانية لو يوجد معلّق
  useEffect(() => {
    if (!userId) return
    void engine.purgeOldSynced(SEVEN_DAYS)
    void syncNow()
    const onOnline = () => void syncNow()
    const onVisible = () => document.visibilityState === 'visible' && void syncNow()
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    const id = setInterval(async () => {
      if (navigator.onLine && (await db.queue.where('status').equals('pending').count()) > 0) void syncNow()
    }, 20_000)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(id)
    }
  }, [engine, userId, syncNow])

  if (!userId) return <>{children}</>
  return (
    <Ctx.Provider
      value={{
        engine,
        userId,
        syncNow,
        syncing,
        pendingCount: counts?.pending ?? 0,
        failedCount: counts?.failed ?? 0,
        otherUsersPending: counts?.others ?? 0,
        lastError,
        lastSyncAt
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useSync(): SyncCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('SyncProvider missing')
  return c
}
