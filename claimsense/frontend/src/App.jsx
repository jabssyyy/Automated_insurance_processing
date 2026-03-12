import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import RoleSelector from './components/RoleSelector';
import PatientView from './components/PatientView';
import HospitalView from './components/HospitalView';

// Lazy placeholder for InsurerView until Person 2 builds it
const InsurerView = () => (
  <div className="min-h-screen bg-slate-50 flex items-center justify-center">
    <div className="text-center">
      <div className="w-20 h-20 bg-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
        <span className="text-3xl">🏢</span>
      </div>
      <h2 className="text-2xl font-bold text-slate-800 mb-2">Insurer View</h2>
      <p className="text-slate-500">Coming soon — assigned to Person 2</p>
    </div>
  </div>
);

function ProtectedRoute({ children, allowedRole }) {
  const { isAuthenticated, role } = useAuth();
  if (!isAuthenticated) return <Navigate to="/" replace />;
  if (allowedRole && role !== allowedRole) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RoleSelector />} />
      <Route
        path="/patient"
        element={
          <ProtectedRoute allowedRole="patient">
            <PatientView />
          </ProtectedRoute>
        }
      />
      <Route
        path="/hospital"
        element={
          <ProtectedRoute allowedRole="hospital_staff">
            <HospitalView />
          </ProtectedRoute>
        }
      />
      <Route
        path="/insurer"
        element={
          <ProtectedRoute allowedRole="insurer">
            <InsurerView />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
