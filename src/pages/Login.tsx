import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Banner, Button, Field, inputClass } from '../components/ui'
import { useAuth } from '../lib/auth'

export default function Login() {
  const { state, signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [fullName, setFullName] = useState('')
  const [mosque, setMosque] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  if (state.status === 'ready') return <Navigate to="/" replace />

  const switchMode = (m: 'signin' | 'signup') => {
    setMode(m)
    setError(null)
    setInfo(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    if (mode === 'signin') {
      const err = await signIn(email, password)
      if (err) setError(err)
    } else {
      const r = await signUp({ fullName, requestedMosque: mosque, email, password })
      if (r.error) setError(r.error)
      else {
        setInfo(r.info ?? null)
        setMode('signin')
        setPassword('')
      }
    }
    setBusy(false)
  }

  const notice = state.status === 'signedOut' ? state.notice : undefined
  const signup = mode === 'signup'

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-brand-900 text-4xl shadow-lg">🌙</div>
        <h1 className="text-2xl font-bold text-brand-900">رجال الفجر</h1>
        <p className="mt-1 text-sm text-brand-700">{signup ? 'إنشاء حساب منظم جديد' : 'تسجيل دخول المنظمين'}</p>
      </div>
      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-brand-100 bg-white p-5 shadow-sm">
        {info && <Banner tone="green">{info}</Banner>}
        {(error || notice) && !info && <Banner tone={error ? 'red' : 'gold'}>{error ?? notice}</Banner>}
        {signup && (
          <>
            <Field label="الاسم">
              <input className={inputClass} required maxLength={60} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </Field>
            <Field label="المسجد الذي ستشرف عليه" hint="للتعريف فقط — المالك هو اللي يربط حسابك بالمسجد.">
              <input className={inputClass} required maxLength={60} value={mosque} onChange={(e) => setMosque(e.target.value)} />
            </Field>
          </>
        )}
        <Field label="البريد الإلكتروني">
          <input className={inputClass} type="email" inputMode="email" autoComplete="username" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="كلمة المرور" hint={signup ? '8 أحرف على الأقل.' : undefined}>
          <input
            className={inputClass}
            type="password"
            autoComplete={signup ? 'new-password' : 'current-password'}
            dir="ltr"
            required
            minLength={signup ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" block disabled={busy}>
          {busy ? 'لحظة…' : signup ? 'إنشاء الحساب' : 'دخول'}
        </Button>
        <button type="button" className="block w-full min-h-11 text-sm font-semibold text-brand-800 underline" onClick={() => switchMode(signup ? 'signin' : 'signup')}>
          {signup ? 'عندي حساب — تسجيل دخول' : 'منظم جديد؟ أنشئ حسابك'}
        </button>
      </form>
      <p className="mt-5 text-center text-xs leading-relaxed text-brand-700">
        الحساب الجديد لا يرى أي بيانات حتى يوافق عليه مالك المبادرة ويربطه بمسجده.
      </p>
    </div>
  )
}
