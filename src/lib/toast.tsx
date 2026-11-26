import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type Kind = 'info' | 'success' | 'error'
interface ToastItem { id: number; kind: Kind; message: string }
const Ctx = createContext<(kind: Kind, message: string) => void>(() => {})
let seq = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((kind: Kind, message: string) => {
    const id = ++seq
    setItems((l) => [...l.slice(-2), { id, kind, message }])
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000)
  }, [])
  const color: Record<Kind, string> = {
    info: 'bg-brand-800 text-white',
    success: 'bg-brand-600 text-white',
    error: 'bg-red-700 text-white'
  }
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-3" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role="status" className={`pointer-events-auto w-full max-w-md rounded-xl px-4 py-3 text-sm shadow-lg ${color[t.kind]}`}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)
