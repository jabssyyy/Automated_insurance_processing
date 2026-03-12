import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.jsx'
import { ShieldCheck, Stethoscope, Building2, Loader2, AlertCircle } from 'lucide-react'

const ROLES = [
  {
    key: 'patient',
    label: 'Patient',
    description: 'View your claim status, upload documents, and get real-time updates.',
    icon: ShieldCheck,
    gradient: 'from-blue-500 to-blue-700',
    ring: 'ring-blue-200',
    bg: 'hover:bg-blue-50',
    route: '/patient',
  },
  {
    key: 'hospital_staff',
    label: 'Hospital Staff',
    description: 'Assemble claim packages, track document status, and submit to insurers.',
    icon: Stethoscope,
    gradient: 'from-teal-500 to-teal-700',
    ring: 'ring-teal-200',
    bg: 'hover:bg-teal-50',
    route: '/hospital',
  },
  {
    key: 'insurer',
    label: 'Insurer',
    description: 'Review claims, run validations, approve or reject with audit trail.',
    icon: Building2,
    gradient: 'from-purple-500 to-purple-700',
    ring: 'ring-purple-200',
    bg: 'hover:bg-purple-50',
    route: '/insurer',
  },
]

export default function RoleSelector() {
  const { login } = useAuth()
  const navigate   = useNavigate()
  const [loading, setLoading]  = useState(null)
  const [error, setError]      = useState(null)

  const handleSelect = async (roleConfig) => {
    setError(null)
    setLoading(roleConfig.key)
    try {
      await login(roleConfig.key)
      navigate(roleConfig.route)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Login failed. Is the backend running?')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <div className="mb-12 text-center">
        <div className="inline-flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">ClaimSense</h1>
        </div>
        <p className="text-slate-500 text-sm font-medium">AI-powered health insurance claims processing</p>
      </div>

      {/* Role cards */}
      <div className="w-full max-w-3xl">
        <p className="text-center text-slate-600 mb-8 text-base font-medium">
          Choose your role to enter the demo
        </p>

        {error && (
          <div className="mb-6 flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {ROLES.map((r) => {
            const Icon = r.icon
            const isLoading = loading === r.key
            return (
              <button
                key={r.key}
                onClick={() => handleSelect(r)}
                disabled={!!loading}
                className={`
                  group relative flex flex-col items-center text-center p-8 rounded-2xl
                  bg-white border-2 border-slate-100 shadow-sm
                  transition-all duration-200 cursor-pointer
                  hover:shadow-xl hover:border-transparent hover:ring-4 ${r.ring}
                  ${r.bg}
                  disabled:opacity-60 disabled:cursor-not-allowed
                `}
              >
                {/* Icon circle */}
                <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${r.gradient} flex items-center justify-center shadow-md mb-5 group-hover:scale-110 transition-transform duration-200`}>
                  {isLoading
                    ? <Loader2 className="w-8 h-8 text-white animate-spin" />
                    : <Icon className="w-8 h-8 text-white" />
                  }
                </div>
                <h2 className="text-xl font-semibold text-slate-800 mb-2">{r.label}</h2>
                <p className="text-sm text-slate-500 leading-relaxed">{r.description}</p>

                {/* Arrow indicator */}
                {!isLoading && (
                  <div className="mt-6 text-xs font-semibold text-slate-400 group-hover:text-blue-600 transition-colors">
                    Enter as {r.label} →
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <p className="mt-12 text-xs text-slate-400">
        Demo mode — pre-seeded accounts, no password required
      </p>
    </div>
  )
}
