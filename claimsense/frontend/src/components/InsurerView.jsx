/**
 * InsurerView — Insurer portal with real API data + SSE.
 *
 * Features:
 *   - Claims sidebar (fetched from /dashboard/claims)
 *   - Claim detail panel with AI recommendation
 *   - Review queue for pending human review items
 *   - Approve / Reject with modal + AI-suggested reasons
 *   - Real-time SSE updates (when patient submits, insurer sees it live)
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ShieldCheck, LogOut, RefreshCw, AlertCircle,
  CheckCircle2, Clock, AlertTriangle, XCircle,
  Loader2, FileText, Activity, ChevronRight, DollarSign,
  ThumbsUp, ThumbsDown, Eye, Bell, Filter, Zap, ClipboardCheck
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth.jsx'
import { useSSE } from '../hooks/useSSE.jsx'
import {
  getClaims, getTimeline, fetchReviewQueue, fetchReviewContext,
  approveReview, rejectReview
} from '../services/api.jsx'

// ── Status badge colors ─────────────────────────────────────────────
const STATUS_STYLES = {
  APPROVED:           { bg: 'bg-green-100', text: 'text-green-700', label: 'Approved' },
  DOCUMENTS_COMPLETE: { bg: 'bg-green-100', text: 'text-green-700', label: 'Docs Complete' },
  DENIED:             { bg: 'bg-red-100',   text: 'text-red-700',   label: 'Denied' },
  DOCUMENTS_MISSING:  { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Docs Missing' },
  POLICY_VALIDATING:  { bg: 'bg-blue-100',  text: 'text-blue-700',  label: 'Validating' },
  ICD_CHECK_RUNNING:  { bg: 'bg-blue-100',  text: 'text-blue-700',  label: 'ICD Check' },
  UNDER_HUMAN_REVIEW: { bg: 'bg-purple-100',text: 'text-purple-700',label: 'Needs Review' },
  ASSEMBLING_PACKAGE: { bg: 'bg-blue-100',  text: 'text-blue-700',  label: 'Packaging' },
  SUBMITTED:          { bg: 'bg-blue-100',  text: 'text-blue-700',  label: 'Submitted' },
  UNDER_INSURER_REVIEW: { bg: 'bg-blue-100',text: 'text-blue-700',  label: 'Insurer Review' },
}

function StatusBadge({ status }) {
  const cfg = STATUS_STYLES[status] || { bg: 'bg-slate-100', text: 'text-slate-600', label: status?.replace(/_/g, ' ') || 'Unknown' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  )
}

// ── Filter options ──────────────────────────────────────────────────
const FILTERS = [
  { label: 'All', value: 'all' },
  { label: 'Needs Review', value: 'UNDER_HUMAN_REVIEW' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Denied', value: 'DENIED' },
  { label: 'Processing', value: 'POLICY_VALIDATING' },
]

// ── AI Recommendation parsing ───────────────────────────────────────
function getAIRecommendation(claim) {
  const m2 = claim?.claim_json?.m2_validation
  if (!m2) return { type: 'pending', text: 'AI analysis pending…', details: [] }

  const coverage = m2.coverage_results || []
  const failedRules = coverage.filter(r => r.status === 'FAIL' || r.passed === false)
  const allPass = failedRules.length === 0

  if (allPass) {
    return {
      type: 'approve',
      text: 'AI recommends APPROVAL — all coverage checks passed',
      details: coverage.map(r => r.message || r.reason || r.rule_name),
    }
  }

  return {
    type: 'review',
    text: `AI flags ${failedRules.length} issue(s) for review`,
    details: failedRules.map(r => r.message || r.reason || r.rule_name),
  }
}


// ── Reject Modal ────────────────────────────────────────────────────

function RejectModal({ claim, reviewId, aiDetails, onClose, onReject }) {
  const [reason, setReason] = useState(aiDetails.join('\n'))
  const [loading, setLoading] = useState(false)

  const handleReject = async () => {
    if (!reason.trim()) return
    setLoading(true)
    try {
      await rejectReview(reviewId, reason.trim())
      onReject()
    } catch (err) {
      console.error('Reject failed:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 m-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
            <ThumbsDown className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">Reject Claim</h3>
            <p className="text-xs text-slate-500">{claim?.claim_id}</p>
          </div>
        </div>

        <div className="mb-4">
          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block">
            Denial Reason
          </label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={5}
            className="w-full text-sm px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400 resize-none"
            placeholder="Enter reason for denial…"
          />
          <p className="text-[10px] text-slate-400 mt-1">Pre-filled with AI recommendation. Edit as needed.</p>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 px-4 text-sm font-semibold text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleReject}
            disabled={loading || !reason.trim()}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ThumbsDown className="w-4 h-4" />}
            Confirm Rejection
          </button>
        </div>
      </div>
    </div>
  )
}


// ── Claim Detail Panel ──────────────────────────────────────────────

function ClaimDetail({ claim, reviewId, onRefresh }) {
  const [approving, setApproving] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [timeline, setTimeline] = useState([])
  const [actionDone, setActionDone] = useState(null) // 'approved' | 'rejected'

  const aiRec = getAIRecommendation(claim)
  const m2 = claim?.claim_json?.m2_validation || {}
  const isReviewable = claim?.current_status === 'UNDER_HUMAN_REVIEW'

  useEffect(() => {
    if (!claim?.claim_id) return
    getTimeline(claim.claim_id).then(res => {
      setTimeline(res.data?.timeline || [])
    }).catch(() => {})
    setActionDone(null)
  }, [claim?.claim_id])

  const handleApprove = async () => {
    if (!reviewId) return
    setApproving(true)
    try {
      await approveReview(reviewId, 'Approved by insurer after AI review')
      setActionDone('approved')
      onRefresh()
    } catch (err) {
      console.error('Approve failed:', err)
    } finally {
      setApproving(false)
    }
  }

  const handleRejectDone = () => {
    setShowRejectModal(false)
    setActionDone('rejected')
    onRefresh()
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h2 className="text-xl font-bold text-slate-900">{claim.claim_id}</h2>
            <StatusBadge status={claim.current_status} />
          </div>
          <p className="text-sm text-slate-500">{claim.patient_name} · {claim.claim_json?.hospital_name || 'Hospital'}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400 uppercase">Total Claimed</p>
          <p className="text-xl font-bold text-slate-800 font-mono">
            ₹{Number(claim.total_amount || 0).toLocaleString('en-IN')}
          </p>
        </div>
      </div>

      {/* AI Recommendation Banner */}
      <div className={`p-5 rounded-2xl border-2 ${
        aiRec.type === 'approve'
          ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200'
          : aiRec.type === 'review'
          ? 'bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200'
          : 'bg-gradient-to-r from-slate-50 to-slate-100 border-slate-200'
      }`}>
        <div className="flex items-start gap-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            aiRec.type === 'approve' ? 'bg-green-100' : aiRec.type === 'review' ? 'bg-amber-100' : 'bg-slate-200'
          }`}>
            {aiRec.type === 'approve'
              ? <CheckCircle2 className="w-5 h-5 text-green-600" />
              : aiRec.type === 'review'
              ? <AlertTriangle className="w-5 h-5 text-amber-600" />
              : <Clock className="w-5 h-5 text-slate-400" />
            }
          </div>
          <div className="flex-1">
            <h3 className={`text-sm font-bold ${
              aiRec.type === 'approve' ? 'text-green-800' : aiRec.type === 'review' ? 'text-amber-800' : 'text-slate-700'
            }`}>
              <Zap className="w-3.5 h-3.5 inline mr-1" />
              AI Recommendation
            </h3>
            <p className={`text-sm mt-1 ${
              aiRec.type === 'approve' ? 'text-green-700' : aiRec.type === 'review' ? 'text-amber-700' : 'text-slate-600'
            }`}>
              {aiRec.text}
            </p>
            {aiRec.details.length > 0 && (
              <ul className="mt-2 space-y-1">
                {aiRec.details.slice(0, 5).map((d, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
                    <ChevronRight className="w-3 h-3 mt-0.5 shrink-0" /> {d}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      {isReviewable && !actionDone && (
        <div className="flex gap-3">
          <button
            onClick={handleApprove}
            disabled={approving}
            className="flex-1 flex items-center justify-center gap-2.5 py-3.5 px-6 rounded-xl bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white text-sm font-semibold shadow-lg shadow-green-200/50 transition-all disabled:opacity-50"
          >
            {approving ? <Loader2 className="w-5 h-5 animate-spin" /> : <ThumbsUp className="w-5 h-5" />}
            Approve Claim
          </button>
          <button
            onClick={() => setShowRejectModal(true)}
            className="flex-1 flex items-center justify-center gap-2.5 py-3.5 px-6 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white text-sm font-semibold shadow-lg shadow-red-200/50 transition-all"
          >
            <ThumbsDown className="w-5 h-5" />
            Reject Claim
          </button>
        </div>
      )}

      {/* Action confirmation */}
      {actionDone && (
        <div className={`p-4 rounded-2xl border-2 text-center ${
          actionDone === 'approved'
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          <p className="text-sm font-bold">
            {actionDone === 'approved' ? '✓ Claim Approved' : '✗ Claim Rejected'}
          </p>
          <p className="text-xs mt-1 opacity-80">
            {actionDone === 'approved'
              ? 'The claim will proceed to final packaging and submission.'
              : 'The patient has been notified of the denial.'}
          </p>
        </div>
      )}

      {/* Claim Details Grid */}
      <div className="grid grid-cols-2 gap-5">
        {/* Left: Patient & Billing */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-500" />
            Claim Details
          </h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {[
              { l: 'Claim ID', v: claim.claim_id },
              { l: 'Status', v: claim.current_status?.replace(/_/g, ' ') },
              { l: 'Patient', v: claim.patient_name || claim.claim_json?.patient_name || '—' },
              { l: 'Hospital', v: claim.claim_json?.hospital_name || '—' },
              { l: 'Admission', v: claim.claim_json?.admission_date || '—' },
              { l: 'Discharge', v: claim.claim_json?.discharge_date || '—' },
              { l: 'Amount', v: claim.total_amount ? `₹${Number(claim.total_amount).toLocaleString('en-IN')}` : '—' },
              { l: 'Created', v: claim.created_at ? new Date(claim.created_at).toLocaleDateString('en-IN') : '—' },
            ].map(({ l, v }) => (
              <div key={l}>
                <dt className="text-[10px] text-slate-400 font-medium uppercase">{l}</dt>
                <dd className="text-xs text-slate-800 font-semibold mt-0.5">{v || '—'}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Right: Coverage Rules */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-blue-500" />
            Coverage Rules
          </h3>
          {(m2.coverage_results || []).length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">Coverage check pending…</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(m2.coverage_results || []).map((rule, i) => (
                <div key={i} className="flex items-start gap-2 py-2 px-3 rounded-lg bg-slate-50 border border-slate-100">
                  <span className={`shrink-0 mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                    (rule.status === 'PASS' || rule.passed)
                      ? 'bg-green-100 text-green-700'
                      : (rule.status === 'FAIL' || rule.passed === false)
                      ? 'bg-red-100 text-red-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}>
                    {rule.status || (rule.passed ? 'PASS' : 'FAIL')}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium text-slate-700 capitalize">{(rule.rule_name || '').replace(/_/g, ' ')}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{rule.message || rule.reason || ''}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ICD Codes */}
      {(m2.code_results || []).length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-500" />
            Medical Codes
          </h3>
          <div className="flex flex-wrap gap-2">
            {(m2.code_results || []).map((code, i) => (
              <div key={i} className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border ${
                code.is_valid !== false ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
              }`}>
                <span className={`font-mono text-xs font-bold ${code.is_valid !== false ? 'text-green-700' : 'text-red-700'}`}>
                  {code.code}
                </span>
                <span className="text-[10px] text-slate-500">{code.description || ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      {timeline.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Claim Timeline</h3>
          <div className="space-y-0">
            {[...timeline].reverse().slice(0, 10).map((entry, i) => (
              <div key={entry.id || i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${
                    i === 0 ? 'bg-blue-500 ring-2 ring-blue-100' : 'bg-slate-300'
                  }`} />
                  {i < Math.min(timeline.length, 10) - 1 && <div className="w-px flex-1 bg-slate-200 my-1" />}
                </div>
                <div className="pb-3">
                  <p className="text-xs font-semibold text-slate-700">{entry.status?.replace(/_/g, ' ')}</p>
                  {entry.detail && <p className="text-[10px] text-slate-500 mt-0.5">{entry.detail}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <RejectModal
          claim={claim}
          reviewId={reviewId}
          aiDetails={aiRec.details}
          onClose={() => setShowRejectModal(false)}
          onReject={handleRejectDone}
        />
      )}
    </div>
  )
}


// ── Main InsurerView ────────────────────────────────────────────────

export default function InsurerView() {
  const { token, logout } = useAuth()
  const navigate = useNavigate()
  const { latestEvent } = useSSE(token)

  const [claims, setClaims] = useState([])
  const [reviewQueue, setReviewQueue] = useState([])
  const [selectedClaimId, setSelectedClaimId] = useState(null)
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [sidebarTab, setSidebarTab] = useState('claims') // 'claims' | 'review'

  const fetchData = useCallback(async () => {
    try {
      const [claimsRes, reviewRes] = await Promise.all([
        getClaims(),
        fetchReviewQueue().catch(() => ({ data: [] })),
      ])
      setClaims(claimsRes.data?.claims || [])
      setReviewQueue(Array.isArray(reviewRes.data) ? reviewRes.data : [])
    } catch (err) {
      console.error('Failed to fetch:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Real-time SSE — auto-refresh when any status changes
  useEffect(() => {
    if (!latestEvent) return
    // Refresh both claims and review queue on any SSE event
    fetchData()
  }, [latestEvent, fetchData])

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  // Filter claims
  const filteredClaims = claims.filter(c => {
    if (filter === 'all') return true
    return c.current_status === filter
  })

  // Current claim detail data
  const selectedClaim = claims.find(c => c.claim_id === selectedClaimId)

  // Find the review_id for the selected claim (if under review)
  const selectedReviewId = reviewQueue.find(r => r.claim_id === selectedClaimId)?.review_id

  const pendingCount = reviewQueue.filter(r => r.status === 'pending').length

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-purple-50/20 to-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-lg border-b border-slate-100 shadow-sm sticky top-0 z-30">
        <div className="px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center shadow-md">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="text-sm font-bold text-slate-900">ClaimSense</span>
              <span className="ml-2 text-xs text-slate-400 font-medium">Insurer Portal</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {pendingCount > 0 && (
              <button
                onClick={() => setSidebarTab('review')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple-700 bg-purple-100 px-3 py-1.5 rounded-full hover:bg-purple-200 transition-colors"
              >
                <Bell className="w-3.5 h-3.5" />
                {pendingCount} pending review
              </button>
            )}
            <button onClick={fetchData} className="p-2 rounded-lg hover:bg-slate-100 transition-colors" title="Refresh">
              <RefreshCw className="w-4 h-4 text-slate-400" />
            </button>
            <button onClick={handleLogout} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors">
              <LogOut className="w-3.5 h-3.5" /> Logout
            </button>
          </div>
        </div>
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <Loader2 className="w-10 h-10 animate-spin text-purple-600 mx-auto" />
            <p className="text-sm text-slate-500">Loading claims…</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <aside className="w-[320px] min-w-[280px] border-r border-slate-100 flex flex-col bg-white/50">
            {/* Sidebar tabs */}
            <div className="p-3 border-b border-slate-100 flex gap-1">
              <button
                onClick={() => setSidebarTab('claims')}
                className={`flex-1 text-xs font-semibold py-2 px-3 rounded-lg transition-all ${
                  sidebarTab === 'claims' ? 'bg-purple-100 text-purple-700' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                All Claims ({claims.length})
              </button>
              <button
                onClick={() => setSidebarTab('review')}
                className={`flex-1 text-xs font-semibold py-2 px-3 rounded-lg transition-all relative ${
                  sidebarTab === 'review' ? 'bg-purple-100 text-purple-700' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                Review Queue
                {pendingCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-[9px] text-white font-bold flex items-center justify-center">
                    {pendingCount}
                  </span>
                )}
              </button>
            </div>

            {sidebarTab === 'claims' && (
              <>
                {/* Filter chips */}
                <div className="p-3 border-b border-slate-50 flex flex-wrap gap-1.5">
                  {FILTERS.map(f => (
                    <button
                      key={f.value}
                      onClick={() => setFilter(f.value)}
                      className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-all ${
                        filter === f.value
                          ? 'bg-purple-100 text-purple-700 border border-purple-200'
                          : 'text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* Claims list */}
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {filteredClaims.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-8">No claims found</p>
                  ) : (
                    filteredClaims.map(c => (
                      <button
                        key={c.claim_id}
                        onClick={() => { setSelectedClaimId(c.claim_id); setSidebarTab('claims') }}
                        className={`w-full text-left p-3 rounded-xl transition-all ${
                          selectedClaimId === c.claim_id
                            ? 'bg-purple-50 border-2 border-purple-200 shadow-sm'
                            : 'hover:bg-slate-50 border-2 border-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-slate-800 font-mono">{c.claim_id}</span>
                          <StatusBadge status={c.current_status} />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-slate-500 truncate pr-2">{c.patient_name || 'Patient'}</span>
                          <span className="text-xs font-bold text-slate-700 font-mono shrink-0">
                            ₹{Number(c.total_amount || 0).toLocaleString('en-IN')}
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}

            {sidebarTab === 'review' && (
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {reviewQueue.length === 0 ? (
                  <div className="text-center py-12">
                    <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-3" />
                    <p className="text-sm font-medium text-slate-600">All caught up!</p>
                    <p className="text-xs text-slate-400 mt-1">No claims pending review</p>
                  </div>
                ) : (
                  reviewQueue.map(r => (
                    <button
                      key={r.review_id}
                      onClick={() => { setSelectedClaimId(r.claim_id) }}
                      className={`w-full text-left p-3 rounded-xl transition-all ${
                        selectedClaimId === r.claim_id
                          ? 'bg-purple-50 border-2 border-purple-200 shadow-sm'
                          : 'hover:bg-slate-50 border-2 border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-slate-800 font-mono">{r.claim_id}</span>
                        <span className="text-[10px] font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-md">
                          REVIEW
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 space-y-0.5">
                        {(r.trigger_reasons || []).slice(0, 2).map((reason, i) => (
                          <p key={i} className="flex items-start gap-1">
                            <AlertTriangle className="w-2.5 h-2.5 mt-0.5 text-amber-500 shrink-0" />
                            <span className="line-clamp-1">{reason}</span>
                          </p>
                        ))}
                      </div>
                      {r.time_in_queue_minutes != null && (
                        <p className="text-[10px] text-slate-400 mt-1">
                          ⏱ {r.time_in_queue_minutes < 60
                            ? `${Math.round(r.time_in_queue_minutes)}m in queue`
                            : `${Math.round(r.time_in_queue_minutes / 60)}h in queue`
                          }
                        </p>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}

            {/* Footer */}
            <div className="p-3 border-t border-slate-100">
              <p className="text-[10px] text-slate-400 text-center">
                {claims.length} total · {pendingCount} pending review
              </p>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 overflow-y-auto p-6">
            {selectedClaim ? (
              <ClaimDetail
                claim={selectedClaim}
                reviewId={selectedReviewId}
                onRefresh={fetchData}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="w-20 h-20 rounded-2xl bg-purple-100 border border-purple-200 flex items-center justify-center mx-auto mb-4">
                    <Eye className="w-10 h-10 text-purple-400" />
                  </div>
                  <h3 className="text-base font-semibold text-slate-600">Select a Claim</h3>
                  <p className="text-xs text-slate-400 mt-1">Choose from the sidebar to view details and take action</p>
                </div>
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  )
}
