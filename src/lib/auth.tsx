import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { db, getMeta, setMeta } from './db'
import { fetchProfile } from './data'
import { supabase } from './supabase'
import type { Profile } from './types'

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; notice?: string }
  | { status: 'ready'; userId: string; profile: Profile; offlineMode: boolean }

interface AuthCtx {
  state: AuthState
  signIn(email: string, password: string): Promise<string | null>
  /** يرجع { error } أو { info } (رسالة نجاح للعرض) */
  signUp(input: { fullName: string; requestedMosque: string; email: string; password: string }): Promise<{ error?: string; info?: string }>
  signOut(): Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

const isNetworkish = (e: unknown) =>
  !navigator.onLine || /fetch|network|load failed|timeout/i.test((e as { message?: string })?.message ?? String(e))

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  const stateRef = useRef(state)
  stateRef.current = state
  const resolving = useRef<Promise<AuthState> | null>(null)

  const resolve = useCallback((): Promise<AuthState> => {
    if (resolving.current) return resolving.current
    const run = async (): Promise<AuthState> => {
      const { data, error } = await supabase.auth.getSession()
      const session = data.session
      if (session) {
        try {
          const profile = await fetchProfile(session.user.id)
          if (!profile || !profile.active) {
            await supabase.auth.signOut({ scope: 'local' })
            return {
              status: 'signedOut',
              notice: !profile
                ? 'حسابك في انتظار موافقة مالك المبادرة. بعد الموافقة ادخل بنفس البريد وكلمة المرور.'
                : 'حسابك موقوف. تواصل مع مالك المبادرة.'
            }
          }
          await setMeta(db, 'profile', profile)
          return { status: 'ready', userId: session.user.id, profile, offlineMode: false }
        } catch (e) {
          const cached = await getMeta<Profile>(db, 'profile')
          if (cached && cached.user_id === session.user.id && isNetworkish(e)) {
            return { status: 'ready', userId: cached.user_id, profile: cached, offlineMode: true }
          }
          return { status: 'signedOut' }
        }
      }
      // لا جلسة: لو لا يوجد اتصال (أو فشل تجديد الجلسة بسبب الشبكة) نسمح بالعمل محليًا بالملف المخزّن
      if (!navigator.onLine || (error && isNetworkish(error))) {
        const cached = await getMeta<Profile>(db, 'profile')
        if (cached && cached.active) {
          return { status: 'ready', userId: cached.user_id, profile: cached, offlineMode: true }
        }
      }
      return { status: 'signedOut' }
    }
    resolving.current = run().finally(() => {
      resolving.current = null
    })
    return resolving.current
  }, [])

  useEffect(() => {
    let alive = true
    resolve().then((s) => alive && setState(s))
    const { data } = supabase.auth.onAuthStateChange((event) => {
      // لا نستدعي Supabase مباشرة داخل الـ callback (قد يسبب deadlock)؛ نؤجّل
      setTimeout(() => {
        if (!alive) return
        if (event === 'SIGNED_OUT') {
          if (stateRef.current.status === 'ready' && stateRef.current.offlineMode) return
          setState({ status: 'signedOut' })
        } else if (event === 'SIGNED_IN' && stateRef.current.status !== 'ready') {
          resolve().then((s) => alive && setState(s))
        }
      }, 0)
    })
    // عودة الاتصال أثناء العمل بالوضع المحلي: نتحقق من الجلسة من جديد
    const onOnline = () => {
      if (stateRef.current.status === 'ready' && stateRef.current.offlineMode) {
        resolve().then((s) => alive && setState(s))
      }
    }
    window.addEventListener('online', onOnline)
    return () => {
      alive = false
      data.subscription.unsubscribe()
      window.removeEventListener('online', onOnline)
    }
  }, [resolve])

  const signIn = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) {
        if (/invalid login/i.test(error.message)) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
        if (isNetworkish(error)) return 'تسجيل الدخول يحتاج اتصالًا بالإنترنت'
        return 'تعذّر تسجيل الدخول، حاول مرة أخرى'
      }
      const s = await resolve()
      setState(s)
      return s.status === 'signedOut' ? s.notice ?? 'تعذّر تسجيل الدخول' : null
    },
    [resolve]
  )

  const signUp = useCallback<AuthCtx['signUp']>(async ({ fullName, requestedMosque, email, password }) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim(), requested_mosque: requestedMosque.trim() } }
    })
    if (error) {
      if (/already registered|already been registered/i.test(error.message)) return { error: 'هذا البريد مسجّل بالفعل — جرّب تسجيل الدخول.' }
      if (/password/i.test(error.message)) return { error: 'كلمة المرور ضعيفة — استخدم 8 أحرف أو أكثر (حروف وأرقام).' }
      if (/rate|too many|seconds/i.test(error.message)) return { error: 'محاولات كثيرة — انتظر دقيقة وحاول مرة أخرى.' }
      if (isNetworkish(error)) return { error: 'إنشاء الحساب يحتاج اتصالًا بالإنترنت' }
      return { error: 'تعذّر إنشاء الحساب، حاول مرة أخرى' }
    }
    if (data.session) {
      // التأكيد بالبريد مُعطَّل: الجلسة اتفتحت فورًا، لكن الحساب بلا صلاحيات لحد موافقة المالك → نخرج
      await supabase.auth.signOut({ scope: 'local' })
      return { info: 'تم إنشاء حسابك ✅ — في انتظار موافقة مالك المبادرة. بعد ما يوافق ادخل بنفس البريد وكلمة المرور.' }
    }
    return { info: 'تم إنشاء حسابك ✅ — افتح رسالة التأكيد على بريدك، وبعدها انتظر موافقة مالك المبادرة.' }
  }, [])

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch {
      /* نكمل التنظيف المحلي */
    }
    // خصوصية الأطفال على الأجهزة المشتركة: نمسح الكاش المقروء. نُبقي طابور المزامنة (معرّفات فقط) كي لا نفقد سجلات.
    await Promise.all([db.participants.clear(), db.attendanceCache.clear(), db.mosques.clear(), db.meta.clear()])
    setState({ status: 'signedOut' })
  }, [])

  return <Ctx.Provider value={{ state, signIn, signUp, signOut }}>{children}</Ctx.Provider>
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('AuthProvider missing')
  return c
}

/** للصفحات التي لا تُعرض إلا بعد الدخول */
export function useSession() {
  const { state } = useAuth()
  if (state.status !== 'ready') throw new Error('not ready')
  return state
}

export const canManage = (role: Profile['role']) => role === 'owner' || role === 'admin'
