/**
 * PatientView — The patient screen.
 *
 * Three-phase flow:
 *   Phase 1: Create Claim  — pick policy & claim type → create
 *   Phase 2: Upload Docs   — drag-drop documents → submit for processing
 *   Phase 3: Live Tracking — pipeline stepper + status timeline + coverage
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ShieldCheck, LogOut, RefreshCw, AlertCircle,
  CheckCircle2, Clock, AlertTriangle, MessageCircle,
  X, Send, Loader2, ChevronRight, DollarSign,
  FileText, Upload, Plus, Activity, ArrowRight,
  Zap, ClipboardCheck, Package, Truck, BadgeCheck, XCircle
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth.jsx'
import { useSSE } from '../hooks/useSSE.jsx'
import StatusTimeline from './StatusTimeline'
import NotificationPanel from './NotificationPanel'
import DocumentUpload from './DocumentUpload'
import {
  getClaims, getTimeline, createClaim, runPipeline,
  continuePipeline, sendChat
} from '../services/api.jsx'


// ── Pipeline stages configuration ───────────────────────────────────────────

const PIPELINE_STAGES = [
  { key: 'DOCUMENTS_MISSING',   label: 'Documents',    icon: FileText,      shortLabel: 'Docs' },
  { key: 'DOCUMENTS_COMPLETE',  label: 'Docs Complete', icon: CheckCircle2,  shortLabel: 'Verified' },
  { key: 'POLICY_VALIDATING',   label: 'Policy Check',  icon: ClipboardCheck, shortLabel: 'Policy' },
  { key: 'ICD_CHECK_RUNNING',   label: 'Medical Codes', icon: Activity,      shortLabel: 'ICD' },
  { key: 'UNDER_HUMAN_REVIEW',  label: 'Review',        icon: ShieldCheck,   shortLabel: 'Review' },
  { key: 'ASSEMBLING_PACKAGE',  label: 'Packaging',     icon: Package,       shortLabel: 'Package' },
  { key: 'SUBMITTED',           label: 'Submitted',     icon: Truck,         shortLabel: 'Submit' },
  { key: 'UNDER_INSURER_REVIEW',label: 'Insurer Review',icon: Clock,         shortLabel: 'Insurer' },
  { key: 'APPROVED',            label: 'Approved',      icon: BadgeCheck,    shortLabel: 'Done' },
  { key: 'DENIED',              label: 'Denied',        icon: XCircle,       shortLabel: 'Denied' },
]

const STAGE_ORDER = PIPELINE_STAGES.map(s => s.key)

function getStageIndex(status) {
  const idx = STAGE_ORDER.indexOf(status)
  return idx >= 0 ? idx : -1
}

// ── Demo policy options ─────────────────────────────────────────────────────

const DEMO_POLICIES = [
  { number: 'STAR-HEALTH-2025-001', name: 'Star Health — Comprehensive Family Floater', sum_insured: '₹10,00,000' },
  { number: 'HDFC-ERGO-2025-042',   name: 'HDFC Ergo — Optima Secure',               sum_insured: '₹5,00,000' },
  { number: 'ICICI-LOMBARD-2025-017', name: 'ICICI Lombard — iHealth Plus',           sum_insured: '₹15,00,000' },
]

const CLAIM_TYPES = [
  { key: 'inpatient', label: 'Inpatient',    desc: 'Hospital stay ≥ 24 hours', icon: '🏥' },
  { key: 'daycare',   label: 'Day Care',     desc: 'Procedure < 24 hours',     icon: '⚡' },
  { key: 'icu',       label: 'ICU',          desc: 'Intensive care unit stay',  icon: '🚑' },
]


// ── Pipeline Stepper Component ──────────────────────────────────────────────

function PipelineStepper({ currentStatus }) {
  const currentIdx = getStageIndex(currentStatus)
  const isDenied = currentStatus === 'DENIED'
  // Filter out DENIED from display if not denied
  const stages = isDenied
    ? PIPELINE_STAGES.filter(s => s.key !== 'APPROVED')
    : PIPELINE_STAGES.filter(s => s.key !== 'DENIED')

  return (
    <div className="w-full overflow-x-auto pb-2">
      <div className="flex items-center min-w-[700px]">
        {stages.map((stage, idx) => {
          const stageIdx = getStageIndex(stage.key)
          const isCurrent = stage.key === currentStatus
          const isDone = stageIdx < currentIdx && !isDenied
          const isFailed = isDenied && stage.key === 'DENIED'
          const isPast = stageIdx < currentIdx
          const Icon = stage.icon

          let dotClass = 'bg-slate-200 text-slate-400'
          let lineClass = 'bg-slate-200'
          let labelClass = 'text-slate-400'

          if (isCurrent) {
            dotClass = 'bg-blue-500 text-white ring-4 ring-blue-100 shadow-lg shadow-blue-200/50'
            labelClass = 'text-blue-700 font-semibold'
          } else if (isDone || isPast) {
            dotClass = 'bg-green-500 text-white'
            lineClass = 'bg-green-400'
            labelClass = 'text-green-700'
          } else if (isFailed) {
            dotClass = 'bg-red-500 text-white ring-4 ring-red-100'
            labelClass = 'text-red-700 font-semibold'
          }

          return (
            <React.Fragment key={stage.key}>
              {idx > 0 && (
                <div className={`flex-1 h-0.5 mx-1 rounded-full transition-all duration-700 ${isPast || isDone ? 'bg-green-400' : isCurrent ? 'bg-blue-300' : 'bg-slate-200'}`} />
              )}
              <div className="flex flex-col items-center gap-1.5 min-w-[60px]">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-500 ${dotClass}`}>
                  {isCurrent && !isDone ? (
                    <div className="relative">
                      <Icon className="w-4 h-4" />
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-blue-400 animate-ping" />
                    </div>
                  ) : isDone ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <Icon className="w-4 h-4" />
                  )}
                </div>
                <span className={`text-[10px] leading-tight text-center transition-colors duration-300 ${labelClass}`}>
                  {stage.shortLabel}
                </span>
              </div>
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}


// ── Phase 1: New Claim Form ───────────────────────────────────────────────────

function NewClaimForm({ onClaimCreated }) {
  const [selectedPolicy, setSelectedPolicy] = useState('')
  const [claimType, setClaimType] = useState('inpatient')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleCreate = async () => {
    if (!selectedPolicy) {
      setError('Please select a policy')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const res = await createClaim(selectedPolicy, claimType)
      onClaimCreated(res.data.claim_id)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to create claim')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Welcome card */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 shadow-xl shadow-blue-200/50 mb-4">
          <Plus className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900">File a New Claim</h2>
        <p className="text-slate-500 mt-2 text-sm">Select your policy and claim type to get started</p>
      </div>

      {error && (
        <div className="mb-6 flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Policy selector */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-blue-500" />
          Select Your Policy
        </h3>
        <div className="space-y-3">
          {DEMO_POLICIES.map((p) => (
            <button
              key={p.number}
              onClick={() => setSelectedPolicy(p.number)}
              className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-200 ${
                selectedPolicy === p.number
                  ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100 shadow-sm'
                  : 'border-slate-100 hover:border-blue-200 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                  <p className="text-xs text-slate-500 mt-1 font-mono">{p.number}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-400">Sum Insured</p>
                  <p className="text-sm font-bold text-slate-700">{p.sum_insured}</p>
                </div>
              </div>
              {selectedPolicy === p.number && (
                <div className="mt-2 flex items-center gap-1 text-xs text-blue-600 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Selected
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Claim type selector */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-500" />
          Claim Type
        </h3>
        <div className="grid grid-cols-3 gap-3">
          {CLAIM_TYPES.map((t) => (
            <button
              key={t.key}
              onClick={() => setClaimType(t.key)}
              className={`p-4 rounded-xl border-2 text-center transition-all duration-200 ${
                claimType === t.key
                  ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100'
                  : 'border-slate-100 hover:border-blue-200'
              }`}
            >
              <span className="text-2xl block mb-2">{t.icon}</span>
              <p className="text-sm font-semibold text-slate-800">{t.label}</p>
              <p className="text-xs text-slate-500 mt-0.5">{t.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={handleCreate}
        disabled={loading || !selectedPolicy}
        className="w-full flex items-center justify-center gap-2.5 py-3.5 px-6 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white text-sm font-semibold shadow-lg shadow-blue-200/50 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-xl"
      >
        {loading ? (
          <><Loader2 className="w-5 h-5 animate-spin" /> Creating Claim…</>
        ) : (
          <><ArrowRight className="w-5 h-5" /> Create Claim & Upload Documents</>
        )}
      </button>
    </div>
  )
}


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
      {patient_summary && (
        <div className="text-sm text-slate-700 leading-relaxed bg-blue-50 rounded-xl p-4 border border-blue-100">
          {patient_summary}
        </div>
      )}
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
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800 text-white shadow-xl shadow-blue-300/30 flex items-center justify-center transition-all hover:scale-110 z-40"
        title="Chat with AI Assistant"
      >
        <MessageCircle className="w-6 h-6" />
      </button>

      {open && (
        <div className="fixed inset-y-0 right-0 w-full max-w-sm bg-white shadow-2xl border-l border-slate-100 flex flex-col z-50">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-blue-600 to-blue-700">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-white" />
              <span className="text-white font-semibold text-sm">Claim Assistant</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-blue-200 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
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


// ── Patient visible statuses ────────────────────────────────────────────────

const PATIENT_VISIBLE = new Set([
  'DOCUMENTS_MISSING', 'DOCUMENTS_COMPLETE', 'POLICY_VALIDATING',
  'ICD_CHECK_RUNNING', 'UNDER_HUMAN_REVIEW', 'ASSEMBLING_PACKAGE',
  'SUBMITTED', 'UNDER_INSURER_REVIEW', 'APPROVED', 'DENIED',
  'QUERY_RAISED', 'ESCALATED_TO_IRDAI',
])


// ── PatientView (main) ────────────────────────────────────────────────────────

export default function PatientView() {
  const { token, logout } = useAuth()
  const navigate = useNavigate()
  const { latestEvent } = useSSE(token)

  const [claim, setClaim] = useState(null)
  const [timeline, setTimeline] = useState([])
  const [loading, setLoading] = useState(true)
  const [currentStatus, setCurrentStatus] = useState(null)
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [pipelineError, setPipelineError] = useState(null)

  // Determine which phase to show
  const claimId = claim?.claim_id
  const hasNoClaim = !claimId && !loading
  const isUploadPhase = claimId && currentStatus === 'DOCUMENTS_MISSING'
  const isTrackingPhase = claimId && currentStatus && currentStatus !== 'DOCUMENTS_MISSING'

  // Fetch claim data
  const fetchData = useCallback(async () => {
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
        setTimeline(rawTimeline)
      }
    } catch (err) {
      console.error('Failed to fetch claims:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // React to SSE events
  useEffect(() => {
    if (!latestEvent) return
    const { status, detail } = latestEvent
    if (status) {
      setCurrentStatus(status)
      setTimeline((prev) => {
        const entry = { status, detail, timestamp: latestEvent.timestamp, id: Date.now() }
        return [...prev, entry]
      })
      // Auto-refresh claim data when we get meaningful status updates
      if (['APPROVED', 'DENIED', 'DOCUMENTS_COMPLETE'].includes(status)) {
        fetchData()
      }
    }
  }, [latestEvent, fetchData])

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  const handleClaimCreated = async (newClaimId) => {
    setClaim({ claim_id: newClaimId, current_status: 'DOCUMENTS_MISSING' })
    setCurrentStatus('DOCUMENTS_MISSING')
    setLoading(false)
  }

  const handleSubmitPipeline = async () => {
    if (!claimId || pipelineRunning) return
    setPipelineRunning(true)
    setPipelineError(null)
    try {
      const res = await runPipeline(claimId)
      const data = res.data
      if (data?.final_status) {
        setCurrentStatus(data.final_status)
      }
      // Refresh to get updated claim data
      await fetchData()
    } catch (err) {
      setPipelineError(err?.response?.data?.detail || 'Pipeline processing failed')
    } finally {
      setPipelineRunning(false)
    }
  }

  // Status banner config
  const BANNER_CONFIG = {
    APPROVED: { color: 'from-green-50 to-emerald-50 border-green-200', icon: CheckCircle2, iconColor: 'text-green-600', label: 'Claim Approved! 🎉', textColor: 'text-green-800' },
    DOCUMENTS_COMPLETE: { color: 'from-green-50 to-emerald-50 border-green-200', icon: CheckCircle2, iconColor: 'text-green-600', label: 'Documents Verified', textColor: 'text-green-800' },
    DENIED: { color: 'from-red-50 to-rose-50 border-red-200', icon: AlertCircle, iconColor: 'text-red-600', label: 'Claim Denied', textColor: 'text-red-800' },
    DOCUMENTS_MISSING: { color: 'from-amber-50 to-orange-50 border-amber-200', icon: Upload, iconColor: 'text-amber-600', label: 'Upload Documents', textColor: 'text-amber-800' },
    POLICY_VALIDATING: { color: 'from-blue-50 to-indigo-50 border-blue-200', icon: Zap, iconColor: 'text-blue-600 animate-pulse', label: 'Validating Policy…', textColor: 'text-blue-800' },
    ICD_CHECK_RUNNING: { color: 'from-blue-50 to-indigo-50 border-blue-200', icon: Activity, iconColor: 'text-blue-600 animate-pulse', label: 'Running Medical Checks…', textColor: 'text-blue-800' },
    UNDER_HUMAN_REVIEW: { color: 'from-purple-50 to-violet-50 border-purple-200', icon: ShieldCheck, iconColor: 'text-purple-600', label: 'Under Expert Review', textColor: 'text-purple-800' },
    ASSEMBLING_PACKAGE: { color: 'from-blue-50 to-indigo-50 border-blue-200', icon: Package, iconColor: 'text-blue-600 animate-pulse', label: 'Preparing Submission…', textColor: 'text-blue-800' },
    SUBMITTED: { color: 'from-blue-50 to-indigo-50 border-blue-200', icon: Truck, iconColor: 'text-blue-600', label: 'Submitted to Insurer', textColor: 'text-blue-800' },
    UNDER_INSURER_REVIEW: { color: 'from-blue-50 to-indigo-50 border-blue-200', icon: Clock, iconColor: 'text-blue-600 animate-pulse', label: 'Insurer Processing…', textColor: 'text-blue-800' },
  }

  const bannerCfg = BANNER_CONFIG[currentStatus] ||
    { color: 'from-slate-50 to-slate-100 border-slate-200', icon: Clock, iconColor: 'text-slate-400', label: currentStatus || 'Loading…', textColor: 'text-slate-700' }
  const BannerIcon = bannerCfg.icon

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-lg border-b border-slate-100 shadow-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-md">
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
                {claimId}
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
            <p className="text-sm text-slate-500">Loading your claims…</p>
          </div>
        </div>
      ) : (
        <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-6">

          {/* ── Phase 1: No claim — show create form ─────────────────── */}
          {hasNoClaim && (
            <NewClaimForm onClaimCreated={handleClaimCreated} />
          )}

          {/* ── Phase 2: Upload documents ────────────────────────────── */}
          {isUploadPhase && (
            <div className="max-w-3xl mx-auto space-y-6">
              {/* Status banner */}
              <div className={`flex items-start gap-4 p-5 rounded-2xl border-2 bg-gradient-to-r ${bannerCfg.color}`}>
                <div className="shrink-0 mt-0.5">
                  <BannerIcon className={`w-7 h-7 ${bannerCfg.iconColor}`} />
                </div>
                <div className="flex-1">
                  <h2 className={`text-lg font-bold ${bannerCfg.textColor}`}>{bannerCfg.label}</h2>
                  <p className={`text-sm mt-1 ${bannerCfg.textColor} opacity-80`}>
                    Upload your hospital bills, discharge summary, and other documents to proceed.
                  </p>
                </div>
              </div>

              {/* Required documents checklist */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-500" />
                  Required Documents
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {['Discharge Summary', 'Hospital Bills & Receipts', 'ID Proof (Aadhaar/PAN)', 'Lab Reports', 'Treatment Records', 'Prescription'].map((doc) => (
                    <div key={doc} className="flex items-center gap-2 py-2 px-3 rounded-lg bg-slate-50 border border-slate-100">
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="text-sm text-slate-700">{doc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Document upload */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                <DocumentUpload claimId={claimId} onUploadComplete={fetchData} />
              </div>

              {/* Submit for processing button */}
              <button
                onClick={handleSubmitPipeline}
                disabled={pipelineRunning}
                className="w-full flex items-center justify-center gap-2.5 py-3.5 px-6 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white text-sm font-semibold shadow-lg shadow-blue-200/50 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-xl"
              >
                {pipelineRunning ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Processing…</>
                ) : (
                  <><Zap className="w-5 h-5" /> Submit for AI Processing</>
                )}
              </button>

              {pipelineError && (
                <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {pipelineError}
                </div>
              )}
            </div>
          )}

          {/* ── Phase 3: Live tracking ───────────────────────────────── */}
          {isTrackingPhase && (
            <div className="space-y-6">
              {/* Status banner */}
              <div className={`flex items-start gap-4 p-5 rounded-2xl border-2 bg-gradient-to-r ${bannerCfg.color}`}>
                <div className="shrink-0 mt-0.5">
                  <BannerIcon className={`w-7 h-7 ${bannerCfg.iconColor}`} />
                </div>
                <div className="flex-1">
                  <h2 className={`text-lg font-bold ${bannerCfg.textColor}`}>{bannerCfg.label}</h2>
                  {timeline.length > 0 && (
                    <p className={`text-sm mt-1 ${bannerCfg.textColor} opacity-80`}>
                      {[...timeline].reverse()[0]?.detail}
                    </p>
                  )}
                </div>
                <button
                  onClick={fetchData}
                  className="shrink-0 p-2 rounded-xl hover:bg-white/50 transition-colors"
                  title="Refresh"
                >
                  <RefreshCw className="w-4 h-4 text-slate-500" />
                </button>
              </div>

              {/* Pipeline stepper */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                <h3 className="text-sm font-semibold text-slate-700 mb-5 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-blue-500" />
                  Claim Pipeline
                </h3>
                <PipelineStepper currentStatus={currentStatus} />
              </div>

              <div className="flex flex-col lg:flex-row gap-6">
                {/* LEFT — 60% */}
                <div className="lg:w-[60%] space-y-5">
                  {/* Claim summary card */}
                  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                    <h3 className="text-sm font-semibold text-slate-700 mb-4">Claim Summary</h3>
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
                      {[
                        { label: 'Claim ID', value: claimId },
                        { label: 'Status', value: currentStatus?.replace(/_/g, ' ') },
                        { label: 'Patient', value: claim?.patient_name || 'Demo Patient' },
                        { label: 'Total Amount', value: claim?.total_amount ? `₹${Number(claim.total_amount).toLocaleString('en-IN')}` : '—' },
                        { label: 'Submitted', value: claim?.created_at ? new Date(claim.created_at).toLocaleDateString('en-IN') : '—' },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <dt className="text-xs text-slate-400 font-medium">{label}</dt>
                          <dd className="text-sm text-slate-800 font-semibold mt-0.5 truncate">{value || '—'}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>

                  {/* Coverage display */}
                  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                    <h3 className="text-sm font-semibold text-slate-700 mb-4">Coverage Details</h3>
                    <CoverageDisplay claim={claim} />
                  </div>
                </div>

                {/* RIGHT — 40% */}
                <div className="lg:w-[40%] space-y-5">
                  {/* Status timeline */}
                  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                    <h3 className="text-sm font-semibold text-slate-700 mb-4">Status Timeline</h3>
                    <StatusTimeline timeline={timeline} />
                  </div>
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
