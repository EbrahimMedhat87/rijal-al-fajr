import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Banner, Button, Field, inputClass } from '../components/ui'
import { useAuth } from '../lib/auth'

export default function Login() {
  const { state, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (state.status === 'ready') return <Navigate to="/" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const err = await signIn(email, password)
    if (err) setError(err)
    setBusy(false)
  }

  const notice = state.status === 'signedOut' ? state.notice : undefined

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-brand-900 text-4xl shadow-lg">🌙</div>
        <h1 className="text-2xl font-bold text-brand-900">رجال الفجر</h1>
        <p className="mt-1 text-sm text-brand-700">تسجيل دخول المنظمين</p>
      </div>
      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-brand-100 bg-white p-5 shadow-sm">
        {(error || notice) && <Banner tone="red">{error ?? notice}</Banner>}
        <Field label="البريد الإلكتروني">
          <input
            className={inputClass}
            type="email"
            inputMode="email"
            autoComplete="username"
            dir="ltr"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="كلمة المرور">
          <input
            className={inputClass}
            type="password"
            autoComplete="current-password"
            dir="ltr"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" block disabled={busy}>
          {busy ? 'جارٍ الدخول…' : 'دخول'}
        </Button>
      </form>
      <p className="mt-5 text-center text-xs leading-relaxed text-brand-700">
        الدخول للمنظمين المعتمدين فقط. لا يوجد تسجيل عام — يُنشئ مالك المبادرة الحسابات.
      </p>
    </div>
  )
}
