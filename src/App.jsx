import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import MyRegion from './pages/MyRegion'
import MyCustomers from './pages/MyCustomers'
import OutreachHub from './pages/OutreachHub'
import Leaderboard from './pages/Leaderboard'
import AdminOverview from './pages/AdminOverview'
import Onboarding from './pages/Onboarding'
import Renewals from './pages/Renewals'
import Payments from './pages/Payments'
import DataConnections from './pages/DataConnections'
import Settings from './pages/Settings'

function Spinner() {
  return (
    <div className="flex items-center justify-center h-screen bg-slate-900">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-usr-pink border-t-transparent rounded-full animate-spin" />
        <span className="text-slate-400 text-sm">Loading...</span>
      </div>
    </div>
  )
}

function ProtectedRoute({ children, adminOnly = false }) {
  const { session, director, loading } = useAuth()
  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  if (adminOnly && director && !director.is_admin) return <Navigate to="/" replace />
  return children
}

function PublicRoute({ children }) {
  const { session, loading } = useAuth()
  if (loading) return <Spinner />
  if (session) return <Navigate to="/" replace />
  return children
}

// Home ("/") forks by role: USR staff land on My Customers (Customer Success
// Hub), Speed Lab Directors land on My Region (unchanged).
function Home() {
  const { director } = useAuth()
  return director?.is_admin ? <MyCustomers /> : <MyRegion />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={<PublicRoute><Login /></PublicRoute>}
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout><Home /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/outreach"
          element={
            <ProtectedRoute>
              <Layout><OutreachHub /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/leaderboard"
          element={
            <ProtectedRoute>
              <Layout><Leaderboard /></Layout>
            </ProtectedRoute>
          }
        />

        {/* Admin-only: Customer Success Hub pages */}
        <Route
          path="/onboarding"
          element={
            <ProtectedRoute adminOnly>
              <Layout><Onboarding /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/renewals"
          element={
            <ProtectedRoute adminOnly>
              <Layout><Renewals /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/payments"
          element={
            <ProtectedRoute adminOnly>
              <Layout><Payments /></Layout>
            </ProtectedRoute>
          }
        />

        {/* Admin: Data Connections (HubSpot ↔ USR DB ↔ assignment linkage audit) */}
        <Route
          path="/connections"
          element={
            <ProtectedRoute adminOnly>
              <Layout><DataConnections /></Layout>
            </ProtectedRoute>
          }
        />

        {/* Admin: Director View (per-director network rollup) */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute adminOnly>
              <Layout><AdminOverview /></Layout>
            </ProtectedRoute>
          }
        />
        {/* Admin: drill into any director's region */}
        <Route
          path="/region/:directorId"
          element={
            <ProtectedRoute adminOnly>
              <Layout><MyRegion /></Layout>
            </ProtectedRoute>
          }
        />
        {/* Per-user account settings (Gmail connection, etc.) — any signed-in user */}
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <Layout><Settings /></Layout>
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
