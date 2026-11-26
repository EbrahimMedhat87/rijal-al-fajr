import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'gold'

const variants: Record<Variant, string> = {
  primary: 'bg-brand-900 text-white active:bg-brand-800 disabled:bg-brand-300',
  secondary: 'bg-brand-50 text-brand-900 border border-brand-200 active:bg-brand-100 disabled:opacity-50',
  danger: 'bg-red-700 text-white active:bg-red-800 disabled:opacity-50',
  ghost: 'bg-transparent text-brand-800 active:bg-brand-50 disabled:opacity-50',
  gold: 'bg-gold-500 text-brand-900 active:bg-gold-400 disabled:opacity-50'
}

export function Button({
  variant = 'primary',
  block,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-base font-semibold transition-colors disabled:cursor-not-allowed ${variants[variant]} ${block ? 'w-full' : ''} ${className}`}
    />
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-brand-100 bg-white p-4 shadow-sm ${className}`}>{children}</section>
}

type Tone = 'green' | 'gold' | 'red' | 'gray' | 'blue'
const tones: Record<Tone, string> = {
  green: 'bg-brand-100 text-brand-800',
  gold: 'bg-gold-100 text-gold-700',
  red: 'bg-red-100 text-red-800',
  gray: 'bg-gray-100 text-gray-700',
  blue: 'bg-sky-100 text-sky-800'
}
export function Badge({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>{children}</span>
}

export function Banner({ tone = 'gold', children }: { tone?: 'gold' | 'red' | 'green' | 'blue'; children: ReactNode }) {
  const c = {
    gold: 'border-gold-400 bg-gold-100 text-brand-900',
    red: 'border-red-300 bg-red-50 text-red-900',
    green: 'border-brand-300 bg-brand-50 text-brand-900',
    blue: 'border-sky-300 bg-sky-50 text-sky-900'
  }[tone]
  return <div role="alert" className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${c}`}>{children}</div>
}

export function Spinner({ label = 'جارٍ التحميل…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-brand-700" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-300 border-t-brand-800" />
      <span>{label}</span>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-brand-200 px-4 py-10 text-center text-brand-700">{children}</div>
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-brand-900">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-brand-700">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'block min-h-12 w-full rounded-xl border border-brand-200 bg-white px-3 py-2.5 text-brand-900 placeholder:text-brand-400 disabled:bg-gray-50'

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="safe-bottom max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-brand-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="flex h-10 w-10 items-center justify-center rounded-full text-xl text-brand-700 active:bg-brand-50">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-10 shrink-0 rounded-full border px-4 text-sm font-semibold ${
        active ? 'border-brand-900 bg-brand-900 text-white' : 'border-brand-200 bg-white text-brand-800'
      }`}
    >
      {children}
    </button>
  )
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-brand-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-brand-700">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
