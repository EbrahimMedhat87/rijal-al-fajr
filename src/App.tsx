import type { ReactElement } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { Banner, Spinner } from './components/ui'
import { AuthProvider, canManage, useAuth, useSession } from './lib/auth'
import { DataProvider } from './lib/app-data'
import { SyncProvider } from './lib/sync-context'
import { ToastProvider } from './lib/toast'
import { isConfigured } from './lib/supabase'
import Admin from './pages/Admin'
import Attendance from './pages/Attendance'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import ParticipantDetail from './pages/ParticipantDetail'
import Participants from './pages/Participants'
import Rankings from './pages/Rankings'
import Reports from './pages/Reports'

function Gate() {
  const { state } = useAuth()
  if (state.status === 'loading') return <Spinner />
  if (state.status === 'signedOut') return <Navigate to="/login" replace />
  return (
    <DataProvider>
      <SyncProvider>
        <Layout />
      </SyncProvider>
    </DataProvider>
  )
}

function RequireManage({ children }: { children: ReactElement }) {
  const { profile } = useSession()
  return canManage(profile.role) ? children : <Navigate to="/" replace />
}

function SetupNeeded() {
  return (
    <div className="mx-auto max-w-md px-5 py-12">
      <Banner tone="red">
        لم يُضبط الاتصال بـ Supabase. أنشئ ملف <code dir="ltr">.env.local</code> وضع فيه <code dir="ltr">VITE_SUPABASE_URL</code> و <code dir="ltr">VITE_SUPABASE_ANON_KEY</code> (انظر <code dir="ltr">.env.example</code> وملف README).
      </Banner>
    </div>
  )
}

export default function App() {
  if (!isConfigured) return <SetupNeeded />
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Gate />}>
              <Route index element={<Dashboard />} />
              <Route path="attendance" element={<Attendance />} />
              <Route path="participants" element={<Participants />} />
              <Route path="participants/:id" element={<ParticipantDetail />} />
              <Route path="rankings" element={<RequireManage><Rankings /></RequireManage>} />
              <Route path="reports" element={<RequireManage><Reports /></RequireManage>} />
              <Route path="admin" element={<Admin />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
