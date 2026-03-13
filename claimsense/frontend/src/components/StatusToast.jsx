/**
 * StatusToast — Animated toast notification for claim status changes.
 * Shows on APPROVED, DENIED, SUBMITTED, UNDER_INSURER_REVIEW, etc.
 * Auto-dismisses after 8 seconds.
 */

import React, { useState, useEffect } from 'react'
import { CheckCircle2, XCircle, Clock, ShieldCheck, Truck, X } from 'lucide-react'

const TOAST_CONFIG = {
  APPROVED: {
    icon: CheckCircle2,
    bg: 'bg-green-50 border-green-300',
    iconColor: 'text-green-600',
    title: 'Claim Approved!',
    textColor: 'text-green-800',
  },
  DENIED: {
    icon: XCircle,
    bg: 'bg-red-50 border-red-300',
    iconColor: 'text-red-600',
    title: 'Claim Denied',
    textColor: 'text-red-800',
  },
  SUBMITTED: {
    icon: Truck,
    bg: 'bg-blue-50 border-blue-300',
    iconColor: 'text-blue-600',
    title: 'Claim Submitted to Insurer',
    textColor: 'text-blue-800',
  },
  UNDER_INSURER_REVIEW: {
    icon: Clock,
    bg: 'bg-indigo-50 border-indigo-300',
    iconColor: 'text-indigo-600',
    title: 'Insurer is Reviewing',
    textColor: 'text-indigo-800',
  },
  UNDER_HUMAN_REVIEW: {
    icon: ShieldCheck,
    bg: 'bg-purple-50 border-purple-300',
    iconColor: 'text-purple-600',
    title: 'Sent for Expert Review',
    textColor: 'text-purple-800',
  },
}

// Statuses that trigger a toast
const TOAST_STATUSES = new Set(Object.keys(TOAST_CONFIG))

export default function StatusToast({ latestEvent }) {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    if (!latestEvent?.status) return
    if (!TOAST_STATUSES.has(latestEvent.status)) return

    const id = Date.now()
    const toast = {
      id,
      status: latestEvent.status,
      detail: latestEvent.detail || '',
      claimId: latestEvent.claim_id || '',
    }

    setToasts(prev => [...prev, toast])

    // Auto-dismiss after 8 seconds
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 8000)
  }, [latestEvent])

  const dismiss = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-20 right-6 z-50 space-y-3 max-w-sm">
      {toasts.map(toast => {
        const cfg = TOAST_CONFIG[toast.status]
        if (!cfg) return null
        const Icon = cfg.icon

        return (
          <div
            key={toast.id}
            className={`flex items-start gap-3 p-4 rounded-xl border-2 shadow-xl ${cfg.bg} animate-slide-in-right`}
          >
            <Icon className={`w-6 h-6 shrink-0 mt-0.5 ${cfg.iconColor}`} />
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-bold ${cfg.textColor}`}>{cfg.title}</p>
              {toast.claimId && (
                <p className="text-xs text-slate-500 font-mono mt-0.5">{toast.claimId}</p>
              )}
              {toast.detail && (
                <p className={`text-xs mt-1 ${cfg.textColor} opacity-80`}>{toast.detail}</p>
              )}
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              className="text-slate-400 hover:text-slate-600 transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
