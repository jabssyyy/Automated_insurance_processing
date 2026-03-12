/**
 * StatusTimeline — vertical timeline of claim status updates.
 * Used by PatientView, HospitalView, InsurerView.
 */

import React from 'react'
import { CheckCircle2, Clock, AlertCircle, AlertTriangle, Circle } from 'lucide-react'

const STATUS_CONFIG = {
  APPROVED: { dot: 'bg-green-500', icon: CheckCircle2, text: 'text-green-700', label: 'Approved' },
  DOCUMENTS_COMPLETE: { dot: 'bg-green-500', icon: CheckCircle2, text: 'text-green-700', label: 'Documents Complete' },
  DENIED: { dot: 'bg-red-500', icon: AlertCircle, text: 'text-red-700', label: 'Denied' },
  DOCUMENTS_MISSING: { dot: 'bg-red-500', icon: AlertCircle, text: 'text-red-700', label: 'Documents Missing' },
  QUERY_RAISED: { dot: 'bg-amber-500', icon: AlertTriangle, text: 'text-amber-700', label: 'Query Raised' },
  ESCALATED_TO_IRDAI: { dot: 'bg-amber-500', icon: AlertTriangle, text: 'text-amber-700', label: 'Escalated to IRDAI' },
  POLICY_VALIDATING: { dot: 'bg-blue-500', icon: Clock, text: 'text-blue-700', label: 'Policy Validating' },
  ICD_CHECK_RUNNING: { dot: 'bg-blue-500', icon: Clock, text: 'text-blue-700', label: 'ICD Check Running' },
  UNDER_HUMAN_REVIEW: { dot: 'bg-blue-500', icon: Clock, text: 'text-blue-700', label: 'Under Human Review' },
  ASSEMBLING_PACKAGE: { dot: 'bg-blue-400', icon: Clock, text: 'text-blue-600', label: 'Assembling Package' },
  SUBMITTED: { dot: 'bg-blue-400', icon: Clock, text: 'text-blue-600', label: 'Submitted' },
  UNDER_INSURER_REVIEW: { dot: 'bg-blue-400', icon: Clock, text: 'text-blue-600', label: 'Under Insurer Review' },
}

function timeAgo(isoString) {
  if (!isoString) return ''
  const diff = Date.now() - new Date(isoString).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function StatusTimeline({ timeline = [] }) {
  if (timeline.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400 text-sm">
        No status updates yet.
      </div>
    )
  }

  // Show newest first
  const sorted = [...timeline].reverse()

  return (
    <div className="relative">
      {sorted.map((entry, idx) => {
        const cfg = STATUS_CONFIG[entry.status] || {
          dot: 'bg-slate-400',
          icon: Circle,
          text: 'text-slate-600',
          label: entry.status,
        }
        const Icon = cfg.icon
        const isLast = idx === sorted.length - 1

        return (
          <div key={entry.id || idx} className="flex gap-3 group">
            {/* Dot + line */}
            <div className="flex flex-col items-center">
              <div className={`w-3 h-3 rounded-full mt-1 shrink-0 ${cfg.dot} ring-2 ring-white shadow-sm`} />
              {!isLast && <div className="w-px flex-1 bg-slate-200 my-1" />}
            </div>

            {/* Content */}
            <div className={`pb-5 ${isLast ? '' : ''}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-semibold uppercase tracking-wide ${cfg.text}`}>
                  {cfg.label}
                </span>
                <span className="text-xs text-slate-400">{timeAgo(entry.timestamp)}</span>
              </div>
              {entry.detail && (
                <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">
                  {entry.detail}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
