/**
 * PatientView — The patient screen.
 *
 * Layout:
 *   Header: logo, claim ID, notification bell, logout
 *   Main:
 *     LEFT 60%:  Status Banner, DocumentUpload, Missing Docs Alert
 *     RIGHT 40%: CoverageDisplay (M2 summary), StatusTimeline
 *   Floating: ChatAssistant button + drawer
 */

import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ShieldCheck, LogOut, RefreshCw, AlertCircle,
  CheckCircle2, Clock, AlertTriangle, MessageCircle,
  X, Send, Loader2, ChevronRight, DollarSign
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useSSE } from '../hooks/useSSE'
import StatusTimeline from './StatusTimeline'
import NotificationPanel from './NotificationPanel'
import DocumentUpload from './DocumentUpload'
import {
  getClaims, getTimeline, runValidation, sendChat
} from '../services/api'

// ── Status banner configuration ─────────────────────────────────────────────

const BANNER_CONFIG = {
  APPROVED: { color: 'bg-green-50 border-green-200', icon: CheckCircle2, iconColor: 'text-green-600', label: 'Claim Approved', textColor: 'text-green-800' },
  DOCUMENTS_COMPLETE: { color: 'bg-green-50 border-green-200', icon: CheckCircle2, iconColor: 'text-green-600', label: 'Documents Complete', textColor: 'text-green-800' },
  DENIED: { color: 'bg-red-50 border-red-200', icon: AlertCircle, iconColor: 'text-red-600', label: 'Claim Denied', textColor: 'text-red-800' },
  DOCUMENTS_MISSING: { color: 'bg-red-50 border-red-200', icon: AlertCircle, iconColor: 'text-red-600', label: 'Documents Missing', textColor: 'text-red-800' },
  QUERY_RAISED: { color: 'bg-amber-50 border-amber-200', icon: AlertTriangle, iconColor: 'text-amber-600', label: 'Query Raised', textColor: 'text-amber-800' },
  ESCALATED_TO_IRDAI: { color: 'bg-amber-50 border-amber-200', icon: AlertTriangle, iconColor: 'text-amber-600', label: 'Escalated to IRDAI', textColor: 'text-amber-800' },
  POLICY_VALIDATING: { color: 'bg-blue-50 border-blue-200', icon: Clock, iconColor: 'text-blue-600', label: 'Validating Policy', textColor: 'text-blue-800' },
  ICD_CHECK_RUNNING: { color: 'bg-blue-50 border-blue-200', icon: Clock, iconColor: 'text-blue-600', label: 'Running Medical Checks', textColor: 'text-blue-800' },
  UNDER_HUMAN_REVIEW: { color: 'bg-blue-50 border-blue-200', icon: Clock, iconColor: 'text-blue-600', label: 'Under Human Review', textColor: 'text-blue-800' },
  SUBMITTED: { color: 'bg-blue-50 border-blue-200', icon: Clock, iconColor: 'text-blue-600', label: 'Submitted to Insurer', textColor: 'text-blue-800' },
}

const PATIENT_VISIBLE = new Set([
  'DOCUMENTS_MISSING', 'DOCUMENTS_COMPLETE', 'POLICY_VALIDATING',
  'UNDER_HUMAN_REVIEW', 'APPROVED', 'DENIED', 'QUERY_RAISED', 'ESCALATED_TO_IRDAI',
])

// ── Coverage display ──────────────────────────────────────────────────────────

function CoverageDisplay({ claim }) {
  const m2 = claim?.claim_json?.m2_validation
  if (!m2) {
    return (
      <div className="text-center py-6 text-slate-400 text-sm">
        Coverage check not yet completed.
      </div>
    )
  }

  const { patient_summary, coverage_results = [] } = m2
  const copayResult = coverage_results.find((r) => r.rule_name === 'copay_calculation')

  return (
    <div className="space-y-4">
      {/* Patient summary */}
      {patient_summary && (
        <div className="text-sm text-slate-700 leading-relaxed bg-blue-50 rounded-xl p-4 border border-blue-100">
          {patient_summary}
        </div>
      )}

      {/* Co-pay callout */}
      {copayResult && copayResult.amount_inr > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="p-2 bg-amber-100 rounded-lg">
            <DollarSign className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="text-xs text-amber-700 font-medium">Your Co-pay Amount</p>
            <p className="text-lg font-bold text-amber-900">
              ₹{copayResult.amount_inr.toLocaleString('en-IN')}
            </p>
          </div>
        </div>
      )}

      {/* Rule-by-rule */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Coverage Rules</p>
        {coverage_results.filter((r) => r.rule_name !== 'copay_calculation').map((rule, i) => (
          <div key={i} className="flex items-start gap-2.5 py-2 px-3 rounded-lg bg-slate-50 border border-slate-100">
            <span className={`mt-0.5 shrink-0 text-xs font-bold px-1.5 py-0.5 rounded-md ${rule.status === 'PASS' ? 'bg-green-100 text-green-700' :
                rule.status === 'FAIL' ? 'bg-red-100 text-red-700' :
                  'bg-amber-100 text-amber-700'
              }`}>
              {rule.status}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-700 capitalize">
                {rule.rule_name.replace(/_/g, ' ')}
              </p>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{rule.reason}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Chat assistant drawer ─────────────────────────────────────────────────────

function ChatAssistant({ claimId }) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hi! I can help you understand your claim status and coverage. What would you like to know?' }
  ])
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    const msg = input.trim()
    if (!msg || loading) return
    setInput('')
    const newMessages = [...messages, { role: 'user', text: msg }]
    setMessages(newMessages)
    setLoading(true)
    try {
      const history = newMessages.slice(0, -1).map((m) => ({ role: m.role, content: m.text }))
      const res = await sendChat(claimId, msg, history)
      setMessages([...newMessages, { role: 'assistant', text: res.data?.reply || res.data?.message || 'Sorry, I could not get a response.' }])
    } catch {
      setMessages([...newMessages, { role: 'assistant', text: 'I\'m having trouble connecting to the assistant. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white shadow-xl flex items-center justify-center transition-all hover:scale-110 z-40"
        title="Chat with AI Assistant"
      >
        <MessageCircle className="w-6 h-6" />
      </button>

      {/* Drawer */}
      {open && (
        <div className="fixed inset-y-0 right-0 w-full max-w-sm bg-white shadow-2xl border-l border-slate-100 flex flex-col z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-blue-600">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-white" />
              <span className="text-white font-semibold text-sm">Claim Assistant</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-blue-200 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${m.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                  }`}>
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 px-4 py-2.5 rounded-2xl rounded-bl-sm">
                  <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ask about your claim…"
                className="flex-1 text-sm px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || loading}
                className="p-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── PatientView (main) ────────────────────────────────────────────────────────

export default function PatientView() {
  const { token, logout } = useAuth()
  const navigate = useNavigate()
  const { latestEvent } = useSSE(token)

  const [claim, setClaim] = useState(null)
  const [timeline, setTimeline] = useState([])
  const [loading, setLoading] = useState(true)
  const [currentStatus, setCurrentStatus] = useState(null)

  // Fetch claim data
  const fetchData = async () => {
    try {
      const res = await getClaims()
      const claims = res.data?.claims || []
      if (claims.length > 0) {
        const c = claims[0]
        setClaim(c)
        setCurrentStatus(c.current_status)
        // Fetch timeline
        const tlRes = await getTimeline(c.claim_id)
        const rawTimeline = tlRes.data?.timeline || []
        setTimeline(rawTimeline.filter((t) => PATIENT_VISIBLE.has(t.status)))
      }
    } catch (err) {
      console.error('Failed to fetch claims:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  // React to SSE events
  useEffect(() => {
    if (!latestEvent) return
    const { status, detail } = latestEvent
    if (status && PATIENT_VISIBLE.has(status)) {
      setCurrentStatus(status)
      setTimeline((prev) => {
        const entry = { status, detail, timestamp: latestEvent.timestamp, id: Date.now() }
        return [...prev, entry]
      })
    }
  }, [latestEvent])

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  const claimId = claim?.claim_id
  const bannerCfg = BANNER_CONFIG[currentStatus] ||
    { color: 'bg-slate-50 border-slate-200', icon: Clock, iconColor: 'text-slate-400', label: currentStatus || 'Loading…', textColor: 'text-slate-700' }
  const BannerIcon = bannerCfg.icon

  const latestDetail = timeline.length > 0
    ? [...timeline].reverse().find((t) => PATIENT_VISIBLE.has(t.status))?.detail
    : null

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-100 shadow-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="text-sm font-bold text-slate-900">ClaimSense</span>
              <span className="ml-2 text-xs text-slate-400 font-medium">Patient Portal</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {claimId && (
              <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Claim {claimId}
              </span>
            )}
            <NotificationPanel />
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Body */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <Loader2 className="w-10 h-10 animate-spin text-blue-600 mx-auto" />
            <p className="text-sm text-slate-500">Loading your claim…</p>
          </div>
        </div>
      ) : (
        <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-6">
          {/* Status Banner */}
          <div className={`flex items-start gap-4 p-5 rounded-2xl border-2 mb-6 ${bannerCfg.color}`}>
            <div className="shrink-0 mt-0.5">
              <BannerIcon className={`w-7 h-7 ${bannerCfg.iconColor}`} />
            </div>
            <div className="flex-1">
              <h2 className={`text-lg font-bold ${bannerCfg.textColor}`}>{bannerCfg.label}</h2>
              {latestDetail && (
                <p className={`text-sm mt-1 ${bannerCfg.textColor} opacity-80`}>{latestDetail}</p>
              )}
            </div>
            {claimId && (
              <button
                onClick={fetchData}
                className="shrink-0 p-2 rounded-xl hover:bg-white/50 transition-colors"
                title="Refresh"
              >
                <RefreshCw className="w-4 h-4 text-slate-500" />
              </button>
            )}
          </div>

          {/* No claim state */}
          {!claimId && !loading && (
            <div className="text-center py-16 text-slate-500">
              <ShieldCheck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-base font-medium">No active claims found.</p>
              <p className="text-sm text-slate-400 mt-1">Your claims will appear here once submitted by your hospital.</p>
            </div>
          )}

          {claimId && (
            <div className="flex flex-col lg:flex-row gap-6">
              {/* LEFT — 60% */}
              <div className="lg:w-[60%] space-y-5">
                {/* Missing docs alert */}
                {currentStatus === 'DOCUMENTS_MISSING' && (
                  <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-2xl p-5">
                    <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-red-800">Documents Required</p>
                      <ul className="mt-2 space-y-1 text-sm text-red-700">
                        {['Discharge Summary', 'Hospital Bills & Receipts', 'Treatment Records', 'Lab Reports'].map((doc) => (
                          <li key={doc} className="flex items-center gap-2">
                            <ChevronRight className="w-3 h-3 shrink-0" /> {doc}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {/* Document upload */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                  <DocumentUpload claimId={claimId} onUploadComplete={fetchData} />
                </div>

                {/* Claim summary card */}
                {claim && (
                  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                    <h3 className="text-sm font-semibold text-slate-700 mb-4">Claim Summary</h3>
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
                      {[
                        { label: 'Claim ID', value: claim.claim_id },
                        { label: 'Status', value: currentStatus?.replace(/_/g, ' ') },
                        { label: 'Patient', value: claim.patient_name },
                        { label: 'Total Amount', value: claim.total_amount ? `₹${Number(claim.total_amount).toLocaleString('en-IN')}` : '—' },
                        { label: 'Submitted', value: claim.created_at ? new Date(claim.created_at).toLocaleDateString('en-IN') : '—' },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <dt className="text-xs text-slate-400 font-medium">{label}</dt>
                          <dd className="text-sm text-slate-800 font-semibold mt-0.5 truncate">{value || '—'}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
              </div>

              {/* RIGHT — 40% */}
              <div className="lg:w-[40%] space-y-5">
                {/* Coverage display */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                  <h3 className="text-sm font-semibold text-slate-700 mb-4">Coverage Details</h3>
                  <CoverageDisplay claim={claim} />
                </div>

                {/* Status timeline */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                  <h3 className="text-sm font-semibold text-slate-700 mb-4">Status Timeline</h3>
                  <StatusTimeline timeline={timeline} />
                </div>
              </div>
            </div>
          )}
        </main>
      )}

      {/* Floating chat button */}
      {claimId && <ChatAssistant claimId={claimId} />}
    </div>
  )
}
