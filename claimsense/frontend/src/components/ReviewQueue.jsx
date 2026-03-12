import React, { useState, useEffect } from 'react'
import { fetchReviewQueue, fetchReviewContext, approveReview, rejectReview } from '../services/api'

/**
 * ReviewQueue — Pending review items table with approve/reject actions.
 *
 * @param {Object} props
 * @param {Function} [props.onDecision] - Called after approve/reject with the claim_id
 */
export default function ReviewQueue({ onDecision }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [expandedContext, setExpandedContext] = useState(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [notes, setNotes] = useState('')
  const [denialReason, setDenialReason] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [toast, setToast] = useState(null)
  const [confirmReject, setConfirmReject] = useState(null)

  // Demo reviewer ID
  const REVIEWER_ID = 1

  useEffect(() => {
    loadQueue()
  }, [])

  async function loadQueue() {
    setLoading(true)
    try {
      const data = await fetchReviewQueue()
      setItems(data)
    } catch (err) {
      // Demo mode: use mock data
      setItems(MOCK_QUEUE)
    }
    setLoading(false)
  }

  async function toggleExpand(item) {
    if (expandedId === item.review_id) {
      setExpandedId(null)
      setExpandedContext(null)
      return
    }

    setExpandedId(item.review_id)
    setContextLoading(true)
    setNotes('')
    setDenialReason('')

    try {
      const ctx = await fetchReviewContext(item.review_id)
      setExpandedContext(ctx)
    } catch {
      // Mock context for demo
      setExpandedContext({
        review_id: item.review_id,
        claim_id: item.claim_id,
        trigger_reasons: item.trigger_reasons,
        coverage_results: MOCK_COVERAGE,
        code_results: MOCK_CODES,
      })
    }
    setContextLoading(false)
  }

  async function handleApprove(reviewId) {
    setActionLoading(true)
    try {
      await approveReview(reviewId, REVIEWER_ID, notes)
      showToast('success', 'Claim approved — proceeding to final assembly')
      setExpandedId(null)
      onDecision?.()
      await loadQueue()
    } catch {
      showToast('success', 'Claim approved — proceeding to final assembly (demo)')
      setItems(prev => prev.filter(i => i.review_id !== reviewId))
      setExpandedId(null)
      onDecision?.()
    }
    setActionLoading(false)
  }

  async function handleReject(reviewId) {
    if (!denialReason.trim()) {
      showToast('error', 'Denial reason is required')
      return
    }
    setActionLoading(true)
    try {
      await rejectReview(reviewId, REVIEWER_ID, notes, denialReason)
      showToast('error', `Claim denied: ${denialReason}`)
      setExpandedId(null)
      onDecision?.()
      await loadQueue()
    } catch {
      showToast('error', `Claim denied: ${denialReason} (demo)`)
      setItems(prev => prev.filter(i => i.review_id !== reviewId))
      setExpandedId(null)
      onDecision?.()
    }
    setActionLoading(false)
    setConfirmReject(null)
  }

  function showToast(type, message) {
    setToast({ type, message })
    setTimeout(() => setToast(null), 4000)
  }

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-primary-300 uppercase tracking-wider">
          Review Queue
        </h3>
        <span className="badge badge-pending">
          {items.length} pending
        </span>
      </div>

      {loading ? (
        <div className="text-center py-8">
          <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-surface-400 mt-2">Loading queue…</p>
        </div>
      ) : items.length === 0 ? (
        <div className="glass-card-flat p-8 text-center">
          <p className="text-surface-400 text-sm">No pending review items</p>
          <p className="text-surface-500 text-xs mt-1">All claims cleared for processing</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.review_id} className="glass-card overflow-hidden">
              {/* Row */}
              <div
                className="flex items-center gap-4 px-5 py-3.5 cursor-pointer hover:bg-surface-800/30 transition-colors"
                onClick={() => toggleExpand(item)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-surface-100 font-mono">
                      {item.claim_id}
                    </span>
                    <span className="badge badge-pending text-[10px]">{item.status}</span>
                  </div>
                  <p className="text-xs text-surface-400 mt-0.5 truncate">
                    {item.trigger_reasons?.slice(0, 2).join(' · ') || 'Review required'}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-primary-300 font-mono">
                    ₹{(item.claim_total || 0).toLocaleString('en-IN')}
                  </p>
                  {item.time_in_queue_minutes != null && (
                    <p className="text-[10px] text-surface-500">
                      {item.time_in_queue_minutes < 60
                        ? `${Math.round(item.time_in_queue_minutes)}m in queue`
                        : `${(item.time_in_queue_minutes / 60).toFixed(1)}h in queue`
                      }
                    </p>
                  )}
                </div>

                <svg
                  className={`w-4 h-4 text-surface-500 transition-transform ${expandedId === item.review_id ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>

              {/* Expanded Context */}
              {expandedId === item.review_id && (
                <div className="border-t border-surface-700/30 px-5 py-4 space-y-4 animate-fade-in">
                  {contextLoading ? (
                    <div className="flex items-center gap-2 py-4">
                      <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs text-surface-400">Loading context…</span>
                    </div>
                  ) : (
                    <>
                      {/* Trigger Reasons */}
                      <div>
                        <p className="text-xs font-semibold text-surface-400 uppercase mb-2">Trigger Reasons</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(item.trigger_reasons || []).map((reason, i) => (
                            <span
                              key={i}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium ${
                                reason.includes('High-value')
                                  ? 'bg-warning/10 text-warning border border-warning/20'
                                  : reason.includes('failed') || reason.includes('FAIL')
                                  ? 'bg-danger/10 text-danger border border-danger/20'
                                  : reason.includes('incompatible')
                                  ? 'bg-danger/10 text-orange-400 border border-orange-400/20'
                                  : 'bg-primary-500/10 text-primary-300 border border-primary-500/20'
                              }`}
                            >
                              {reason.includes('High-value') ? '💰' : reason.includes('incompatible') ? '⚠️' : '🔍'}
                              {reason}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* M2 Summary */}
                      {expandedContext?.coverage_results && (
                        <div>
                          <p className="text-xs font-semibold text-surface-400 uppercase mb-2">
                            Coverage Results Summary
                          </p>
                          <div className="grid grid-cols-3 gap-2">
                            {expandedContext.coverage_results.map((r, i) => (
                              <div
                                key={i}
                                className={`p-2 rounded-lg text-xs ${
                                  r.passed
                                    ? 'bg-success/5 border border-success/15'
                                    : 'bg-danger/5 border border-danger/15'
                                }`}
                              >
                                <span className={r.passed ? 'text-success' : 'text-danger'}>
                                  {r.passed ? '✓' : '✗'}
                                </span>{' '}
                                <span className="text-surface-300">
                                  {(r.rule_name || '').replace(/_/g, ' ')}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Action Panel */}
                      <div className="space-y-3 pt-2 border-t border-surface-700/20">
                        <div>
                          <label className="text-xs font-medium text-surface-400 block mb-1">
                            Reviewer Notes (optional)
                          </label>
                          <textarea
                            className="input"
                            placeholder="Add notes for audit trail…"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={2}
                          />
                        </div>

                        <div className="flex gap-3">
                          {/* Approve */}
                          <button
                            className="btn btn-success flex-1"
                            onClick={() => handleApprove(item.review_id)}
                            disabled={actionLoading}
                          >
                            {actionLoading ? (
                              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                            Approve Claim
                          </button>

                          {/* Reject */}
                          <button
                            className="btn btn-danger flex-1"
                            onClick={() => setConfirmReject(item.review_id)}
                            disabled={actionLoading}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            Reject Claim
                          </button>
                        </div>
                      </div>

                      {/* Reject Confirmation Dialog */}
                      {confirmReject === item.review_id && (
                        <div className="bg-danger/5 border border-danger/20 rounded-xl p-4 space-y-3 animate-fade-in">
                          <p className="text-sm font-semibold text-danger">
                            Confirm Rejection
                          </p>
                          <div>
                            <label className="text-xs font-medium text-surface-400 block mb-1">
                              Denial Reason (required — shown to patient)
                            </label>
                            <textarea
                              className="input"
                              placeholder="e.g. Excluded pre-existing condition, documentation incomplete…"
                              value={denialReason}
                              onChange={(e) => setDenialReason(e.target.value)}
                              rows={2}
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              className="btn btn-danger flex-1"
                              onClick={() => handleReject(item.review_id)}
                              disabled={actionLoading || !denialReason.trim()}
                            >
                              Confirm Denial
                            </button>
                            <button
                              className="btn btn-ghost"
                              onClick={() => setConfirmReject(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────
   Mock data for demo mode
   ───────────────────────────────────────────────────────── */

const MOCK_QUEUE = [
  {
    review_id: 1,
    claim_id: 'CS-2026-0042',
    trigger_reasons: [
      'High-value claim (Rs. 6,50,000 exceeds threshold Rs. 5,00,000)',
      'Sub-limit exceeded — room_rent_check: Room rent EXCEEDS limit',
    ],
    claim_total: 650000,
    status: 'pending',
    created_at: new Date().toISOString(),
    time_in_queue_minutes: 45,
  },
  {
    review_id: 2,
    claim_id: 'CS-2026-0038',
    trigger_reasons: [
      'ICD-10 incompatible pair: J06.9+36.1 — URI does not warrant cardiac bypass',
    ],
    claim_total: 285000,
    status: 'pending',
    created_at: new Date().toISOString(),
    time_in_queue_minutes: 120,
  },
  {
    review_id: 3,
    claim_id: 'CS-2026-0051',
    trigger_reasons: [
      'Coverage check failed — exclusion_check: Pre-existing condition excluded',
    ],
    claim_total: 175000,
    status: 'pending',
    created_at: new Date().toISOString(),
    time_in_queue_minutes: 15,
  },
]

const MOCK_COVERAGE = [
  { rule_name: 'policy_active_check', passed: true, message: 'Policy active', details: {} },
  { rule_name: 'waiting_period_check', passed: true, message: '334 days elapsed', details: {} },
  { rule_name: 'exclusion_check', passed: false, message: 'Pre-existing condition excluded', details: {} },
  { rule_name: 'room_rent_check', passed: false, message: 'Room rent exceeds limit', details: { excess_inr: 5000 } },
  { rule_name: 'copay_calculation', passed: true, message: '10% co-pay applied', details: {} },
  { rule_name: 'sum_insured_check', passed: true, message: 'Within sum insured', details: {} },
]

const MOCK_CODES = [
  { code: 'I21.0', is_valid: true, description: 'Acute MI anterior wall' },
  { code: '36.06', is_valid: true, description: 'PCI/Angioplasty' },
]
