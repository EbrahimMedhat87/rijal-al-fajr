import { liveQuery } from 'dexie'
import { useEffect, useState } from 'react'

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

/** يقرأ من IndexedDB ويتحدّث تلقائيًا مع أي تغيير (Dexie liveQuery) */
export function useLive<T>(querier: () => T | Promise<T>, deps: unknown[] = []): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined)
  useEffect(() => {
    const sub = liveQuery(querier).subscribe({
      next: setValue,
      error: (e) => console.error('liveQuery', e)
    })
    return () => sub.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return value
}

/** ترتيب القوائم (بالرقم/بالاسم) — يُحفظ على الجهاز لو أمكن (التخزين قد لا يعمل في بعض المتصفحات فنتجاهل الخطأ) */
export function useSortMode(): ['no' | 'name', (m: 'no' | 'name') => void] {
  const [mode, setMode] = useState<'no' | 'name'>(() => {
    try {
      return localStorage.getItem('rf-sort') === 'name' ? 'name' : 'no'
    } catch {
      return 'no'
    }
  })
  return [
    mode,
    (m) => {
      setMode(m)
      try {
        localStorage.setItem('rf-sort', m)
      } catch {
        /* تجاهل */
      }
    }
  ]
}
