import { useLayoutEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAppData } from '../lib/app-data'
import { canManage, useAuth, useSession } from '../lib/auth'
import { useOnline } from '../lib/hooks'
import { useSync } from '../lib/sync-context'
import { Badge, Banner, Button, Modal } from './ui'

const ROLE_AR = { owner: 'مالك', admin: 'مشرف', recorder: 'مسجِّل' } as const

export function StatusBadges() {
  const online = useOnline()
  const { pendingCount, syncing, failedCount, lastError } = useSync()
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone={online ? 'green' : 'red'}>{online ? '● متصل' : '● غير متصل'}</Badge>
      {syncing ? (
        <Badge tone="blue">⟳ جارٍ المزامنة</Badge>
      ) : pendingCount > 0 ? (
        <Badge tone="gold">⏳ {pendingCount} بانتظار المزامنة</Badge>
      ) : (
        <Badge tone="green">✓ كل شيء متزامن</Badge>
      )}
      {failedCount > 0 && <Badge tone="red">✕ {failedCount} فشل</Badge>}
      {online && lastError && !syncing && <Badge tone="red">تعذّرت المزامنة</Badge>}
    </div>
  )
}

export default function Layout() {
  const session = useSession()
  const { signOut } = useAuth()
  const { campaign } = useAppData()
  const { pendingCount, otherUsersPending, syncNow, syncing, lastError } = useSync()
  const navigate = useNavigate()
  const [menu, setMenu] = useState(false)
  const headerRef = useRef<HTMLElement>(null)
  // ارتفاع الهيدر يُنشر كمتغير CSS ليلتصق شريط البحث في شاشة التحضير تحته مباشرة
  useLayoutEffect(() => {
    const el = headerRef.current
    if (!el) return
    const set = () => document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const role = session.profile.role
  const manage = canManage(role)

  const nav = [
    { to: '/', label: 'الرئيسية', icon: '⌂', end: true },
    { to: '/attendance', label: 'التحضير', icon: '✓' },
    ...(manage ? [{ to: '/rankings', label: 'الترتيب', icon: '★' }] : []),
    { to: '/participants', label: 'الأطفال', icon: '☺' },
    ...(manage ? [{ to: '/reports', label: 'التقارير', icon: '▤' }] : [])
  ]

  const logout = async () => {
    if (pendingCount > 0) {
      const ok = window.confirm(
        `يوجد ${pendingCount} سجل حضور لم يُزامَن بعد.\nلن تُرسَل إلا بعد تسجيل الدخول بنفس الحساب وتوفر الإنترنت.\nهل تريد الخروج؟`
      )
      if (!ok) return
    }
    setMenu(false)
    await signOut()
    navigate('/login')
  }

  return (
    <div className="mx-auto flex h-dvh max-w-2xl flex-col overflow-hidden bg-cream">
      <header ref={headerRef} className="safe-top z-30 shrink-0 border-b border-brand-800 bg-brand-900 text-white">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-lg font-bold">🌙 {campaign?.name ?? 'رجال الفجر'}</div>
            <div className="truncate text-xs text-brand-200">
              {session.profile.display_name} · {ROLE_AR[role]}
            </div>
          </div>
          <button type="button" onClick={() => setMenu(true)} aria-label="القائمة" className="flex h-11 w-11 items-center justify-center rounded-full text-2xl active:bg-brand-800">
            ☰
          </button>
        </div>
        <div className="bg-brand-50 px-4 py-2 text-brand-900">
          <StatusBadges />
        </div>
      </header>

      <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-6">
        {/* مسافة علوية بعنصر عادي وليست padding: iOS Safari يحسب padding الحاوية في موضع الـ sticky فيظهر المحتوى فوق شريط البحث */}
        <div aria-hidden className="h-4" />
        {session.offlineMode && (
          <div className="mb-3">
            <Banner tone="blue">أنت تعمل بدون اتصال. يمكنك تسجيل الحضور وسيُحفَظ على هذا الجهاز ويُرسَل تلقائيًا عند عودة الإنترنت.</Banner>
          </div>
        )}
        {otherUsersPending > 0 && (
          <div className="mb-3">
            <Banner tone="gold">يوجد {otherUsersPending} سجل محفوظ على هذا الجهاز باسم مستخدم آخر، وسيُرسَل عند دخول ذلك المستخدم.</Banner>
          </div>
        )}
        <Outlet />
      </main>

      <nav className="safe-bottom z-30 shrink-0 border-t border-brand-200 bg-white" aria-label="التنقل الرئيسي">
        <ul className="mx-auto flex max-w-2xl">
          {nav.map((n) => (
            <li key={n.to} className="flex-1">
              <NavLink
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${isActive ? 'text-brand-900' : 'text-brand-500'}`
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={`flex h-8 w-14 items-center justify-center rounded-full text-lg ${isActive ? 'bg-gold-100 text-brand-900' : ''}`}>{n.icon}</span>
                    {n.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {menu && (
        <Modal title="القائمة" onClose={() => setMenu(false)}>
          <div className="space-y-3">
            <div className="rounded-xl bg-brand-50 p-3 text-sm text-brand-900">
              <div className="font-bold">{session.profile.display_name}</div>
              <div>{ROLE_AR[role]}</div>
            </div>
            <Button
              block
              variant="secondary"
              disabled={syncing}
              onClick={async () => {
                await syncNow()
              }}
            >
              {syncing ? 'جارٍ المزامنة…' : 'مزامنة الآن'}
            </Button>
            {lastError && <Banner tone="red">{lastError}</Banner>}
            {manage && (
              <Button
                block
                variant="secondary"
                onClick={() => {
                  setMenu(false)
                  navigate('/admin')
                }}
              >
                الإدارة
              </Button>
            )}
            <Button block variant="danger" onClick={logout}>
              تسجيل الخروج
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
