/**
 * PatientView — The patient screen.
 *
 * Three-step claim creation wizard:
 *   Step 1: Select Policy
 *   Step 2: Select Claim Type (Reimbursement / Cashless)
 *   Step 3: Upload Documents + Submit
 *
 * After submission → Confirmation screen with AI summary
 * Then → Live tracking with pipeline stepper + timeline
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ShieldCheck, LogOut, RefreshCw, AlertCircle,
  CheckCircle2, Clock, AlertTriangle, MessageCircle,
  X, Send, Loader2, ChevronRight, DollarSign,
  FileText, Upload, Plus, Activity, ArrowRight, ArrowLeft,
  Zap, ClipboardCheck, Package, Truck, BadgeCheck, XCircle
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth.jsx'
import { useSSE } from '../hooks/useSSE.jsx'
import StatusTimeline from './StatusTimeline'
import NotificationPanel from './NotificationPanel'
import ClaimDocUpload from './ClaimDocUpload'
import {
  getClaims, getTimeline, createClaim, runPipeline,
  uploadDocuments, sendChat
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
]

const DEMO_POLICIES = [
  { number: 'STAR-HEALTH-2025-001', name: 'Star Comprehensive', sum_insured: '₹10,00,000', type: 'Comprehensive' },
  { number: 'HDFC-ERGO-2025-042',   name: 'HDFC Ergo Optima',  sum_insured: '₹5,00,000',  type: 'Individual' },
  { number: 'ICICI-LOMBARD-2025-77', name: 'ICICI Lombard iHealth', sum_insured: '₹15,00,000', type: 'Family Floater' },
]

const CLAIM_TYPES = [
  { key: 'reimbursement', label: 'Reimbursement', desc: 'Claim after paying hospital', icon: '💰' },
  { key: 'cashless', label: 'Cashless', desc: 'Direct settlement with hospital', icon: '🏥' },
]


// ── Pipeline Stepper ────────────────────────────────────────────────────────

function PipelineStepper({ currentStatus }) {
  const currentIdx = PIPELINE_STAGES.findIndex(s => s.key === currentStatus)

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2">
      {PIPELINE_STAGES.map((stage, idx) => {
        const Icon = stage.icon
        const isDone = idx < currentIdx
        const isCurrent = idx === currentIdx
        const isFuture = idx > currentIdx

        return (
          <React.Fragment key={stage.key}>
            <div className={`flex flex-col items-center min-w-[60px] ${isFuture ? 'opacity-40' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                isDone ? 'bg-green-100 text-green-600' :
                isCurrent ? 'bg-blue-100 text-blue-600 ring-2 ring-blue-200 animate-pulse' :
                'bg-slate-100 text-slate-400'
              }`}>
                {isDone ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
              </div>
              <span className={`text-[9px] mt-1 text-center font-semibold leading-tight ${
                isCurrent ? 'text-blue-600' : isDone ? 'text-green-600' : 'text-slate-400'
              }`}>
                {stage.shortLabel}
              </span>
            </div>
            {idx < PIPELINE_STAGES.length - 1 && (
              <div className={`flex-1 h-0.5 min-w-[12px] rounded ${
                idx < currentIdx ? 'bg-green-300' : 'bg-slate-200'
              }`} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}


// ── Coverage Display ────────────────────────────────────────────────────────

function CoverageDisplay({ claim }) {
  const m2 = claim?.claim_json?.m2_validation
  if (!m2?.coverage_results?.length) {
    return <p className="text-xs text-slate-400 italic">Coverage details will appear after policy validation.</p>
  }
  return (
    <div className="space-y-2">
      {m2.coverage_results.map((r, i) => (
        <div key={i} className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-slate-50 border border-slate-100">
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
            r.status === 'PASS' ? 'bg-green-100 text-green-600' :
            r.status === 'WARNING' ? 'bg-amber-100 text-amber-600' :
            'bg-red-100 text-red-600'
          }`}>
            {r.status === 'PASS' ? '✓' : r.status === 'WARNING' ? '!' : '✗'}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-700 truncate">{r.rule_name?.replace(/_/g, ' ')}</p>
            <p className="text-[10px] text-slate-500 truncate">{r.reason}</p>
          </div>
        </div>
      ))}
    </div>
  )
}


// ── Chat Assistant ──────────────────────────────────────────────────────────

function ChatAssistant({ claimId }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hello! I can help you understand your claim status, coverage details, or answer any questions about the process.' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text }])
    setLoading(true)
    try {
      const res = await sendChat(claimId, text, messages)
      const reply = res.data?.response || res.data?.reply || 'I could not process that. Please try again.'
      setMessages(prev => [...prev, { role: 'assistant', text: reply }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Sorry, I encountered an error. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-gradient-to-br from-blue-600 to-blue-700 shadow-xl shadow-blue-200/50 flex items-center justify-center z-40 hover:scale-105 transition-transform"
        >
          <MessageCircle className="w-6 h-6 text-white" />
        </button>
      )}
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


// ── Wizard Step Indicator ───────────────────────────────────────────────────

function WizardSteps({ currentStep }) {
  const steps = [
    { num: 1, label: 'Select Policy' },
    { num: 2, label: 'Claim Type' },
    { num: 3, label: 'Upload & Submit' },
  ]

  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {steps.map((step, idx) => (
        <React.Fragment key={step.num}>
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
              step.num < currentStep ? 'bg-green-500 text-white' :
              step.num === currentStep ? 'bg-blue-600 text-white ring-2 ring-blue-200' :
              'bg-slate-200 text-slate-500'
            }`}>
              {step.num < currentStep ? <CheckCircle2 className="w-4 h-4" /> : step.num}
            </div>
            <span className={`text-xs font-semibold hidden sm:inline ${
              step.num === currentStep ? 'text-blue-600' :
              step.num < currentStep ? 'text-green-600' : 'text-slate-400'
            }`}>
              {step.label}
            </span>
          </div>
          {idx < steps.length - 1 && (
            <div className={`w-12 h-0.5 rounded ${
              step.num < currentStep ? 'bg-green-400' : 'bg-slate-200'
            }`} />
          )}
        </React.Fragment>
      ))}
    </div>
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

  // Core state
  const [claim, setClaim] = useState(null)
  const [timeline, setTimeline] = useState([])
  const [loading, setLoading] = useState(true)
  const [currentStatus, setCurrentStatus] = useState(null)
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [pipelineError, setPipelineError] = useState(null)
  const [demoMode, setDemoMode] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)

  // Wizard state
  const [wizardStep, setWizardStep] = useState(1)
  const [selectedPolicy, setSelectedPolicy] = useState('')
  const [claimType, setClaimType] = useState('reimbursement')
  const [wizardError, setWizardError] = useState(null)
  const [creatingClaim, setCreatingClaim] = useState(false)

  // AI analysis result for confirmation screen
  const [aiSummary, setAiSummary] = useState(null)

  // Determine which phase to show
  const claimId = claim?.claim_id
  const isTerminal = currentStatus === 'APPROVED' || currentStatus === 'DENIED'
  const hasNoClaim = (!claimId && !loading) || (isTerminal && !loading && showNewForm)
  const isTrackingPhase = claimId && currentStatus && currentStatus !== 'DOCUMENTS_MISSING' && !showNewForm

  // Fetch claim data
  const fetchData = useCallback(async () => {
    try {
      const res = await getClaims()
      const claims = res.data?.claims || []
      if (claims.length > 0) {
        const c = claims[0]
        setClaim(c)
        setCurrentStatus(c.current_status)
        // Check for AI summary
        if (c.claim_json?.ai_analysis?.policyholder_summary) {
          setAiSummary(c.claim_json.ai_analysis.policyholder_summary)
        }
        // Fetch timeline
        const tlRes = await getTimeline(c.claim_id)
        const rawTimeline = tlRes.data?.timeline || []
        setTimeline(rawTimeline)
      }
    } catch (err) {
      console.error('Failed to fetch claims:', err)
      setDemoMode(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // React to SSE events — auto-refresh
  useEffect(() => {
    if (!latestEvent) return
    const { status, detail } = latestEvent
    if (status) {
      setCurrentStatus(status)
      setTimeline((prev) => {
        const entry = { status, detail, timestamp: latestEvent.timestamp, id: Date.now() }
        return [...prev, entry]
      })
      setLastUpdated(new Date())
      // Auto-refresh claim data on meaningful status updates
      if (['APPROVED', 'DENIED', 'DOCUMENTS_COMPLETE', 'UNDER_HUMAN_REVIEW'].includes(status)) {
        fetchData()
      }
    }
  }, [latestEvent, fetchData])

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  // ── Step 1 → 2 ────────────────────────────────────────
  const handlePolicyNext = () => {
    if (!selectedPolicy) {
      setWizardError('Please select a policy')
      return
    }
    setWizardError(null)
    setWizardStep(2)
  }

  // ── Step 2 → 3: Create claim in backend, then move to upload ──
  const handleClaimTypeNext = async () => {
    setWizardError(null)
    setCreatingClaim(true)
    try {
      const res = await createClaim(selectedPolicy, 'inpatient', claimType)
      const newClaimId = res.data?.claim_id
      setClaim({ claim_id: newClaimId, current_status: 'DOCUMENTS_MISSING' })
      setCurrentStatus('DOCUMENTS_MISSING')
      setWizardStep(3)
    } catch (err) {
      // Demo mode fallback
      const demoId = `CS-DEMO-${Date.now().toString(36).toUpperCase()}`
      setClaim({ claim_id: demoId, current_status: 'DOCUMENTS_MISSING' })
      setCurrentStatus('DOCUMENTS_MISSING')
      setDemoMode(true)
      setWizardStep(3)
    } finally {
      setCreatingClaim(false)
    }
  }

  // ── Step 3: Upload docs + submit ──
  const handleClaimSubmit = async (allFiles, ckycNumber) => {
    const cid = claim?.claim_id
    if (!cid) return

    setPipelineRunning(true)
    setPipelineError(null)

    try {
      // 1. Upload all files
      const rawFiles = allFiles.map(f => f.file)
      await uploadDocuments(cid, rawFiles)

      // 2. Run full pipeline (includes AI analysis)
      const res = await runPipeline(cid)
      const data = res.data
      if (data?.final_status) {
        setCurrentStatus(data.final_status)
      }

      // 3. Refresh to get updated claim data + AI analysis
      await fetchData()
      setShowNewForm(false)
    } catch (err) {
      console.warn('Pipeline failed, running demo simulation:', err)
      setDemoMode(true)
      await simulatePipeline()
    } finally {
      setPipelineRunning(false)
    }
  }

  const startNewClaim = () => {
    setClaim(null)
    setCurrentStatus(null)
    setTimeline([])
    setShowNewForm(true)
    setDemoMode(false)
    setWizardStep(1)
    setSelectedPolicy('')
    setClaimType('reimbursement')
    setAiSummary(null)
  }

  // Demo pipeline simulation
  const simulatePipeline = async () => {
    const stages = [
      { status: 'DOCUMENTS_COMPLETE', detail: 'All documents received and verified', delay: 1200 },
      { status: 'POLICY_VALIDATING', detail: 'Validating policy coverage rules…', delay: 1500 },
      { status: 'ICD_CHECK_RUNNING', detail: 'Running ICD-10 code validation…', delay: 1200 },
      { status: 'UNDER_HUMAN_REVIEW', detail: 'Claim flagged for insurer review (high value)', delay: 2000 },
      { status: 'ASSEMBLING_PACKAGE', detail: 'Building FHIR R4 clean-claim package…', delay: 1500 },
      { status: 'SUBMITTED', detail: 'Submitted to insurer portal', delay: 1200 },
      { status: 'UNDER_INSURER_REVIEW', detail: 'Insurer processing claim…', delay: 2500 },
      { status: 'APPROVED', detail: 'Claim approved! Settlement initiated 🎉', delay: 0 },
    ]
    for (const stage of stages) {
      await new Promise(r => setTimeout(r, stage.delay))
      setCurrentStatus(stage.status)
      setTimeline(prev => [...prev, { status: stage.status, detail: stage.detail, timestamp: new Date().toISOString(), id: Date.now() }])
      if (stage.status === 'POLICY_VALIDATING') {
        setAiSummary({
          outcome: 'Likely to be Approved',
          reason: 'All mandatory documents present. Claim amount within policy limit.'
        })
      }
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 flex flex-col pb-8">
      {/* Demo mode banner */}
      {demoMode && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center">
          <span className="text-xs font-semibold text-amber-700">⚡ Demo Mode — running with simulated data</span>
        </div>
      )}
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
            {isTerminal && (
              <button
                onClick={startNewClaim}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-full transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> New Claim
              </button>
            )}
            {lastUpdated && (
              <span className="hidden sm:inline text-[10px] text-slate-400">
                Updated {lastUpdated.toLocaleTimeString()}
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
        <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-6">

          {/* ── Wizard: Steps 1-3 ──────────────────────────────────── */}
          {hasNoClaim && (
            <div className="max-w-2xl mx-auto">
              <WizardSteps currentStep={wizardStep} />

              {wizardError && (
                <div className="mb-6 flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {wizardError}
                </div>
              )}

              {/* ── Step 1: Select Policy ─────────────────── */}
              {wizardStep === 1 && (
                <div>
                  <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 shadow-xl shadow-blue-200/50 mb-4">
                      <Plus className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900">File a New Claim</h2>
                    <p className="text-slate-500 mt-2 text-sm">Select your active insurance policy to get started</p>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-5">
                    <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-blue-500" />
                      Your Active Policies
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
                              <p className="text-[10px] text-slate-400 mt-0.5">{p.type}</p>
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

                  <button
                    onClick={handlePolicyNext}
                    disabled={!selectedPolicy}
                    className="w-full flex items-center justify-center gap-2.5 py-3.5 px-6 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white text-sm font-semibold shadow-lg shadow-blue-200/50 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-xl"
                  >
                    <ArrowRight className="w-5 h-5" /> Continue to Claim Type
                  </button>
                </div>
              )}

              {/* ── Step 2: Select Claim Type ─────────────── */}
              {wizardStep === 2 && (
                <div>
                  <div className="text-center mb-8">
                    <h2 className="text-xl font-bold text-slate-900">Select Claim Type</h2>
                    <p className="text-slate-500 mt-2 text-sm">Choose how you'd like to file this claim</p>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-6">
                    <div className="grid grid-cols-2 gap-4">
                      {CLAIM_TYPES.map((t) => (
                        <button
                          key={t.key}
                          onClick={() => setClaimType(t.key)}
                          className={`p-6 rounded-xl border-2 text-center transition-all duration-200 ${
                            claimType === t.key
                              ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100'
                              : 'border-slate-100 hover:border-blue-200'
                          }`}
                        >
                          <span className="text-3xl block mb-3">{t.icon}</span>
                          <p className="text-sm font-semibold text-slate-800">{t.label}</p>
                          <p className="text-xs text-slate-500 mt-1">{t.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => setWizardStep(1)}
                      className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors"
                    >
                      <ArrowLeft className="w-4 h-4" /> Back
                    </button>
                    <button
                      onClick={handleClaimTypeNext}
                      disabled={creatingClaim}
                      className="flex-[2] flex items-center justify-center gap-2 py-3 px-6 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white text-sm font-semibold shadow-lg shadow-blue-200/50 transition-all duration-200 disabled:opacity-50"
                    >
                      {creatingClaim ? (
                        <><Loader2 className="w-5 h-5 animate-spin" /> Creating Claim…</>
                      ) : (
                        <><ArrowRight className="w-5 h-5" /> Continue to Upload</>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Step 3: Upload Documents + Submit ─────── */}
              {wizardStep === 3 && claimId && (
                <div>
                  <div className="text-center mb-6">
                    <h2 className="text-xl font-bold text-slate-900">Upload Documents & Submit</h2>
                    <p className="text-slate-500 mt-2 text-sm">
                      Upload your medical documents below. All 3 mandatory docs are required.
                    </p>
                    <p className="text-xs text-blue-600 font-medium mt-1">
                      Claim ID: {claimId} · Policy: {selectedPolicy} · Type: {claimType}
                    </p>
                  </div>

                  <ClaimDocUpload
                    claimId={claimId}
                    onSubmit={handleClaimSubmit}
                    submitting={pipelineRunning}
                  />

                  {pipelineError && (
                    <div className="mt-4 flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      {pipelineError}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── AI Summary Confirmation (shows after submission) ─── */}
          {aiSummary && isTrackingPhase && (
            <div className={`mb-6 p-5 rounded-2xl border-2 ${
              aiSummary.outcome?.includes('Approved')
                ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200'
                : aiSummary.outcome?.includes('Rejected')
                  ? 'bg-gradient-to-r from-red-50 to-rose-50 border-red-200'
                  : 'bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200'
            }`}>
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  aiSummary.outcome?.includes('Approved')
                    ? 'bg-green-100'
                    : aiSummary.outcome?.includes('Rejected')
                      ? 'bg-red-100'
                      : 'bg-amber-100'
                }`}>
                  <Zap className={`w-5 h-5 ${
                    aiSummary.outcome?.includes('Approved')
                      ? 'text-green-600'
                      : aiSummary.outcome?.includes('Rejected')
                        ? 'text-red-600'
                        : 'text-amber-600'
                  }`} />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">AI Assessment</p>
                  <p className="text-base font-bold text-slate-900">{aiSummary.outcome}</p>
                  <p className="text-sm text-slate-600 mt-1">{aiSummary.reason}</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Live Tracking Phase ────────────────────────────────── */}
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
                        { label: 'Patient', value: claim?.patient_name || claim?.claim_json?.patient_name || '—' },
                        { label: 'Total Amount', value: claim?.total_amount ? `₹${Number(claim.total_amount).toLocaleString('en-IN')}` : '—' },
                        { label: 'Policy', value: claim?.claim_json?.policy_number || selectedPolicy || '—' },
                        { label: 'Type', value: claim?.claim_json?.claim_type || claimType || '—' },
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
