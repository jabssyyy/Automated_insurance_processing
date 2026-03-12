import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Shield, Building2, Stethoscope, ArrowRight, Loader2 } from 'lucide-react';

const roles = [
  {
    key: 'patient',
    label: 'Patient',
    desc: 'Track your claim, upload documents, chat with assistant',
    Icon: Shield,
    gradient: 'from-blue-600 to-blue-500',
    shadow: 'shadow-blue-200',
    ring: 'ring-blue-200',
    path: '/patient',
  },
  {
    key: 'hospital_staff',
    label: 'Hospital Staff',
    desc: 'Manage admissions, verify documents, track pre-auth',
    Icon: Stethoscope,
    gradient: 'from-teal-600 to-teal-500',
    shadow: 'shadow-teal-200',
    ring: 'ring-teal-200',
    path: '/hospital',
  },
  {
    key: 'insurer',
    label: 'Insurer',
    desc: 'Review claims, approve/deny, view validation reports',
    Icon: Building2,
    gradient: 'from-purple-600 to-purple-500',
    shadow: 'shadow-purple-200',
    ring: 'ring-purple-200',
    path: '/insurer',
  },
];

export default function RoleSelector() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [loading, setLoading] = useState(null);

  const handleSelect = async (role) => {
    setLoading(role.key);
    try {
      await login(role.key);
      navigate(role.path);
    } catch (err) {
      console.error('Login failed:', err);
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex flex-col items-center justify-center px-6">
      {/* Logo */}
      <div className="mb-12 text-center animate-fade-in">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="w-14 h-14 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl flex items-center justify-center shadow-xl shadow-blue-200">
            <span className="text-white font-black text-2xl">CS</span>
          </div>
        </div>
        <h1 className="text-4xl font-black text-slate-900 tracking-tight">
          ClaimSense<span className="text-blue-600">.ai</span>
        </h1>
        <p className="text-slate-500 mt-2 text-lg font-medium">
          AI-powered neutral middleware for Indian health insurance
        </p>
      </div>

      {/* Role Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">
        {roles.map((role, idx) => {
          const { Icon } = role;
          const isLoading = loading === role.key;
          return (
            <button
              key={role.key}
              onClick={() => handleSelect(role)}
              disabled={!!loading}
              className={`
                group relative bg-white rounded-2xl p-8 border border-slate-200
                text-left transition-all duration-300 outline-none
                hover:shadow-xl hover:${role.shadow} hover:-translate-y-1
                focus-visible:ring-4 focus-visible:${role.ring}
                disabled:opacity-60 disabled:cursor-wait
                animate-fade-in
              `}
              style={{ animationDelay: `${idx * 100}ms` }}
            >
              {/* Icon */}
              <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${role.gradient} flex items-center justify-center mb-5 shadow-lg ${role.shadow} group-hover:scale-110 transition-transform duration-300`}>
                <Icon className="w-7 h-7 text-white" />
              </div>

              {/* Text */}
              <h2 className="text-xl font-bold text-slate-900 mb-2">{role.label}</h2>
              <p className="text-sm text-slate-500 leading-relaxed mb-6">{role.desc}</p>

              {/* CTA */}
              <div className={`flex items-center gap-2 text-sm font-semibold bg-clip-text text-transparent bg-gradient-to-r ${role.gradient}`}>
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                    <span className="text-slate-400">Logging in…</span>
                  </>
                ) : (
                  <>
                    <span>Enter as {role.label}</span>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <p className="mt-16 text-xs text-slate-400">
        TN-IMPACT 2026 · Team Seraphex · Problem Statement TNI26085
      </p>
    </div>
  );
}
