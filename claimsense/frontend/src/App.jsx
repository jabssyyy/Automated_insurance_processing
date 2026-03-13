import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth.jsx'
import RoleSelector from './components/RoleSelector'
import PatientView from './components/PatientView'
import ServerStatus from './components/ServerStatus'

// Lazy placeholders for views built by other team members
const HospitalView = React.lazy(() =>
  import('./components/HospitalView').catch(() => ({
    default: () => (
      <div className="flex items-center justify-center h-screen text-slate-500">
        HospitalView — coming soon
      </div>
    ),
  }))
)

const InsurerView = React.lazy(() =>
  import('./components/InsurerView').catch(() => ({
    default: () => (
      <div className="flex items-center justify-center h-screen text-slate-500">
        InsurerView — coming soon
      </div>
    ),
  }))
)

function ProtectedRoute({ children, requiredRole }) {
  const { isAuthenticated, role } = useAuth()
  if (!isAuthenticated) return <Navigate to="/" replace />
  if (requiredRole && role !== requiredRole && role !== 'admin') {
    return <Navigate to="/" replace />
  }
  return children
}

function AppRoutes() {
  return (
    <React.Suspense fallback={
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-600 border-t-transparent" />
      </div>
    }>
      <Routes>
        <Route path="/" element={<RoleSelector />} />
        <Route
          path="/patient"
          element={
            <ProtectedRoute requiredRole="patient">
              <PatientView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hospital"
          element={
            <ProtectedRoute requiredRole="hospital_staff">
              <HospitalView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/insurer"
          element={
            <ProtectedRoute requiredRole="insurer">
              <InsurerView />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </React.Suspense>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
        <ServerStatus />
      </BrowserRouter>
    </AuthProvider>
  )
}
