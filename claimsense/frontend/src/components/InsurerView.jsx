import React, { useState, useEffect } from 'react'
import CoverageDisplay from './CoverageDisplay'
import AdjudicatorSummary from './AdjudicatorSummary'
import ReviewQueue from './ReviewQueue'

/**
 * InsurerView — Main insurer portal screen.
 *
 * Layout:
 *   Header  — purple accent, notification bell, chat button
 *   Sidebar — claims queue with filter tabs
 *   Main    — selected claim details, coverage, review, adjudicator summary
 */
export default function InsurerView() {
  const [claims, setClaims] = useState(DEMO_CLAIMS)
  const [filter, setFilter] = useState('all')
  const [selectedClaim, setSelectedClaim] = useState(null)
  const [showReviewQueue, setShowReviewQueue] = useState(false)
  const [notifications, setNotifications] = useState(3)
  const [showNotifications, setShowNotifications] = useState(false)

  const filteredClaims = claims.filter(c => {
    if (filter === 'all') return true
    return c.status.toLowerCase().replace(/\s+/g, '_') === filter
  })

  const selected = claims.find(c => c.claim_id === selectedClaim)

  function handleDecision() {
    // Refresh after review decision
    setShowReviewQueue(false)
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* ══════════════════════════════════════════════════════════
          Header
         ══════════════════════════════════════════════════════════ */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-surface-950/80 border-b border-primary-700/20">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            {/* Logo */}
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-lg shadow-primary-500/20">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold text-surface-100 tracking-tight">
                ClaimSense<span className="text-primary-400">.ai</span>
              </h1>
              <p className="text-[10px] text-surface-500 uppercase tracking-widest">Insurer Portal</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Review Queue Toggle */}
            <button
              className={`btn ${showReviewQueue ? 'btn-primary' : 'btn-ghost'} text-xs`}
              onClick={() => setShowReviewQueue(!showReviewQueue)}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Review Queue
            </button>

            {/* Notification Bell */}
            <button
              className="relative p-2 rounded-lg hover:bg-surface-800 transition-colors"
              onClick={() => setShowNotifications(!showNotifications)}
              id="notification-bell"
            >
              <svg className="w-5 h-5 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {notifications > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-danger rounded-full text-[9px] font-bold text-white flex items-center justify-center">
                  {notifications}
                </span>
              )}
            </button>

            {/* Notification Dropdown */}
            {showNotifications && (
              <div className="absolute top-14 right-6 w-80 glass-card p-3 space-y-2 z-50 animate-fade-in">
                <p className="text-xs font-semibold text-surface-400 uppercase">Notifications</p>
                {DEMO_NOTIFICATIONS.map((n, i) => (
                  <div key={i} className="p-2.5 rounded-lg bg-surface-800/50 hover:bg-surface-800 transition-colors cursor-pointer">
                    <p className="text-xs text-surface-200">{n.message}</p>
                    <p className="text-[10px] text-surface-500 mt-1">{n.time}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════════
          Main Layout
         ══════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Sidebar ───────────────────────────────────────────── */}
        <aside className="w-[30%] min-w-[300px] max-w-[400px] border-r border-surface-800 flex flex-col bg-surface-950/50">
          {/* Filter Tabs */}
          <div className="p-3 border-b border-surface-800/50">
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map(f => (
                <button
                  key={f.value}
                  className={`text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1.5 rounded-lg transition-all ${
                    filter === f.value
                      ? 'bg-primary-600/20 text-primary-300 border border-primary-500/30'
                      : 'text-surface-500 hover:text-surface-300 hover:bg-surface-800/50'
                  }`}
                  onClick={() => setFilter(f.value)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Claims List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredClaims.map(claim => (
              <div
                key={claim.claim_id}
                className={`p-3 rounded-xl cursor-pointer transition-all ${
                  selectedClaim === claim.claim_id
                    ? 'bg-primary-600/15 border border-primary-500/30'
                    : 'hover:bg-surface-800/40 border border-transparent'
                }`}
                onClick={() => {
                  setSelectedClaim(claim.claim_id)
                  setShowReviewQueue(false)
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-surface-100 font-mono">
                    {claim.claim_id}
                  </span>
                  <StatusBadge status={claim.status} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-surface-400 truncate pr-2">
                    {claim.patient_name}
                  </span>
                  <span className="text-xs font-bold text-primary-300 font-mono shrink-0">
                    ₹{claim.total.toLocaleString('en-IN')}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Sidebar Footer */}
          <div className="p-3 border-t border-surface-800/50">
            <p className="text-[10px] text-surface-500 text-center">
              {filteredClaims.length} claims · {claims.filter(c => c.status === 'Pending Review').length} pending review
            </p>
          </div>
        </aside>

        {/* ── Main Content ──────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {showReviewQueue ? (
            <ReviewQueue onDecision={handleDecision} />
          ) : selected ? (
            <ClaimDetail claim={selected} />
          ) : (
            <EmptyState />
          )}
        </main>
      </div>

      {/* ── Floating Chat Button ────────────────────────────────── */}
      <button
        className="fixed bottom-6 right-6 w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-xl shadow-primary-500/30 flex items-center justify-center hover:scale-105 transition-transform z-40"
        id="chat-assistant-btn"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </button>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   Claim Detail — Selected claim in main area
   ═══════════════════════════════════════════════════════════ */

function ClaimDetail({ claim }) {
  const m2 = claim.m2_validation || {}
  const m3 = claim.m3_package || {}
  const submission = claim.submission || null

  return (
    <div className="space-y-6 animate-fade-in">
      {/* TOP: Overview Card */}
      <div className="glass-card p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-lg font-bold text-surface-100">{claim.claim_id}</h2>
              <StatusBadge status={claim.status} />
            </div>
            <p className="text-sm text-surface-400">{claim.patient_name} · {claim.hospital}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-surface-500 uppercase">Total Claimed</p>
            <p className="text-xl font-bold text-primary-300 font-mono">
              ₹{claim.total.toLocaleString('en-IN')}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <InfoCard label="Admission" value={claim.admission_date} />
          <InfoCard label="Discharge" value={claim.discharge_date} />
          <InfoCard label="Policy" value={claim.policy_number} />
          <InfoCard label="Pre-Auth" value={claim.pre_auth || 'N/A'} />
        </div>

        {/* Billing Breakdown */}
        {claim.billing && (
          <div className="mt-4 pt-4 border-t border-surface-700/30 grid grid-cols-6 gap-2">
            {Object.entries(claim.billing).map(([key, val]) => (
              key !== 'total' && (
                <div key={key} className="text-center">
                  <p className="text-[10px] text-surface-500 uppercase">{key.replace(/_/g, ' ')}</p>
                  <p className="text-xs font-semibold text-surface-200 font-mono">₹{val.toLocaleString('en-IN')}</p>
                </div>
              )
            ))}
          </div>
        )}
      </div>

      {/* MIDDLE: Coverage Display + Review Panel */}
      <div className="grid grid-cols-2 gap-6">
        <CoverageDisplay mode="insurer" m2Results={m2} />

        {/* Review Action Panel (if under review) */}
        {claim.status === 'Pending Review' && (
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-warning uppercase tracking-wider mb-3">
              ⚡ Review Required
            </h3>
            <div className="space-y-2 mb-4">
              {(claim.trigger_reasons || []).map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-surface-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
                  {r}
                </div>
              ))}
            </div>
            <p className="text-xs text-surface-500">
              Use the Review Queue to approve or reject this claim.
            </p>
          </div>
        )}
      </div>

      {/* BOTTOM: Adjudicator Summary + Status Timeline */}
      <div className="grid grid-cols-2 gap-6">
        <AdjudicatorSummary
          summary={m3.adjudicator_summary || claim.adjudicator_summary || ''}
          fhirPackage={m3.fhir_package || null}
          fhirSummary={m3.fhir_summary || ''}
          submission={submission}
        />

        <StatusTimeline steps={claim.timeline || DEMO_TIMELINE} />
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   Status Timeline
   ═══════════════════════════════════════════════════════════ */

function StatusTimeline({ steps }) {
  return (
    <div className="glass-card p-5">
      <h3 className="text-sm font-semibold text-primary-300 uppercase tracking-wider mb-4">
        Claim Timeline
      </h3>
      <div className="space-y-0">
        {steps.map((step, i) => (
          <div key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={`w-3 h-3 rounded-full shrink-0 ${
                step.active ? 'bg-primary-500 pulse-glow' : step.completed ? 'bg-success' : 'bg-surface-700'
              }`} />
              {i < steps.length - 1 && (
                <div className={`w-0.5 flex-1 min-h-[32px] ${
                  step.completed ? 'bg-success/30' : 'bg-surface-800'
                }`} />
              )}
            </div>
            <div className="pb-4">
              <p className={`text-xs font-medium ${
                step.active ? 'text-primary-300' : step.completed ? 'text-surface-200' : 'text-surface-500'
              }`}>
                {step.label}
              </p>
              {step.time && (
                <p className="text-[10px] text-surface-500">{step.time}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   Sub-components
   ═══════════════════════════════════════════════════════════ */

function StatusBadge({ status }) {
  const map = {
    'Pending Review': 'badge-pending',
    'Submitted': 'badge-submitted',
    'Approved': 'badge-approved',
    'Denied': 'badge-denied',
    'Processing': 'badge-warning',
  }
  return (
    <span className={`badge ${map[status] || 'badge-pending'}`}>
      {status}
    </span>
  )
}

function InfoCard({ label, value }) {
  return (
    <div className="glass-card-flat p-2.5 text-center">
      <p className="text-[10px] text-surface-500 uppercase">{label}</p>
      <p className="text-xs font-semibold text-surface-200 mt-0.5 font-mono truncate">{value}</p>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="w-20 h-20 rounded-2xl bg-primary-600/10 border border-primary-500/20 flex items-center justify-center mx-auto mb-4">
          <svg className="w-10 h-10 text-primary-500/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-surface-300">Select a claim</h3>
        <p className="text-xs text-surface-500 mt-1">Choose from the sidebar to view details</p>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   Constants & Demo Data
   ═══════════════════════════════════════════════════════════ */

const FILTERS = [
  { label: 'All', value: 'all' },
  { label: 'Pending Review', value: 'pending_review' },
  { label: 'Submitted', value: 'submitted' },
  { label: 'Approved', value: 'approved' },
  { label: 'Denied', value: 'denied' },
]

const DEMO_NOTIFICATIONS = [
  { message: 'CS-2026-0042: High-value claim flagged for review (₹6,50,000)', time: '5 min ago' },
  { message: 'CS-2026-0038: Incompatible ICD-10 pair detected — J06.9 + 36.1', time: '45 min ago' },
  { message: 'CS-2026-0044: Claim approved and submitted to insurer', time: '2 hours ago' },
]

const DEMO_TIMELINE = [
  { label: 'Documents Received', completed: true, time: '10:32 AM' },
  { label: 'AI Extraction (M1)', completed: true, time: '10:33 AM' },
  { label: 'Policy Validation (M2)', completed: true, time: '10:34 AM' },
  { label: 'Human Review', active: true, time: 'Awaiting' },
  { label: 'Final Package (M3)', completed: false },
  { label: 'Submitted to Insurer', completed: false },
]

const DEMO_CLAIMS = [
  {
    claim_id: 'CS-2026-0042',
    patient_name: 'Rajesh Kumar',
    hospital: 'Apollo Hospital, Chennai',
    total: 650000,
    status: 'Pending Review',
    admission_date: '2026-03-01',
    discharge_date: '2026-03-05',
    policy_number: 'STAR-2025-001',
    pre_auth: 'PA-2026-0042',
    billing: { room: 25000, icu: 60000, ot: 45000, medicines: 35000, diagnostics: 18000, other: 7000 },
    trigger_reasons: [
      'High-value claim (Rs. 6,50,000 exceeds threshold Rs. 5,00,000)',
      'Sub-limit exceeded — room_rent_check: Room rent exceeds limit',
    ],
    m2_validation: {
      coverage_results: [
        { rule_name: 'policy_active_check', passed: true, message: 'Policy active: admission within policy dates', details: {} },
        { rule_name: 'waiting_period_check', passed: true, message: 'Waiting period satisfied: 334 days elapsed', details: {} },
        { rule_name: 'exclusion_check', passed: true, message: 'No excluded conditions found', details: {} },
        { rule_name: 'room_rent_check', passed: false, message: 'Room rent EXCEEDS limit: ₹6250/day vs ₹5000/day limit', details: { room_per_day_inr: 6250, limit_per_day_inr: 5000, excess_inr: 5000 } },
        { rule_name: 'copay_calculation', passed: true, message: 'Co-pay: 10% = ₹65,000', details: { copay_amount_inr: 65000, insurer_pays_inr: 585000 } },
        { rule_name: 'sub_limit_icu_check', passed: true, message: 'ICU charges within sub-limit', details: {} },
        { rule_name: 'sub_limit_ot_check', passed: true, message: 'OT charges within sub-limit', details: {} },
        { rule_name: 'pre_auth_check', passed: true, message: 'Pre-authorization present: PA-2026-0042', details: {} },
        { rule_name: 'sum_insured_check', passed: false, message: 'Total ₹6,50,000 EXCEEDS sum insured ₹5,00,000', details: { total_inr: 650000, sum_insured_inr: 500000, excess_inr: 150000 } },
      ],
      code_results: [
        { code: 'I21.0', is_valid: true, description: 'Acute transmural MI anterior wall' },
        { code: 'I25.1', is_valid: true, description: 'Atherosclerotic heart disease' },
        { code: '36.06', is_valid: true, description: 'PCI / Angioplasty' },
        { code: '36.07', is_valid: true, description: 'Drug-eluting coronary stent' },
      ],
    },
    adjudicator_summary: '## 1. Patient and Admission Overview\nRajesh Kumar (M, DOB: 1975-06-15) was admitted to Apollo Hospital, Chennai on 2026-03-01 for acute anterior wall myocardial infarction (I21.0) and underwent percutaneous coronary intervention (PCI) with drug-eluting stent placement.\n\n## 2. Medically Necessary Services\n- PCI with stent (36.06, 36.07) — standard of care for acute MI\n- ICU stay — post-PCI monitoring required per cardiology guidelines\n- Diagnostic tests — pre and post-procedural assessment\n\n## 3. Length of Stay Assessment\n4-day stay (March 1-5) for PCI with stent is within standard cardiology guidelines (typical: 3-5 days).\n\n## 4. Guideline Alignment\n4-day stay for angioplasty with stent is within standard cardiology guidelines.\n\n## 5. Coding Assessment\n- All ICD-10 and procedure codes validated successfully\n- I21.0 + 36.06/36.07 is a clinically appropriate combination\n\n## 6. Coverage Rule Results\n- ✅ PASS: Policy active, waiting period, exclusions, copay, ICU/OT sub-limits, pre-auth\n- ❌ FAIL: Room rent exceeds limit by ₹5,000\n- ❌ FAIL: Total ₹6,50,000 exceeds sum insured ₹5,00,000\n\n## 7. Recommendation\n**REVIEW REQUIRED** — Claim exceeds sum insured by ₹1,50,000 and room rent is above policy limit.',
    timeline: DEMO_TIMELINE,
  },
  {
    claim_id: 'CS-2026-0038',
    patient_name: 'Priya Sharma',
    hospital: 'Fortis Hospital, Mumbai',
    total: 285000,
    status: 'Pending Review',
    admission_date: '2026-02-28',
    discharge_date: '2026-03-03',
    policy_number: 'ICICI-2025-789',
    pre_auth: 'PA-2026-0038',
    billing: { room: 18000, icu: 0, ot: 35000, medicines: 22000, diagnostics: 12000, other: 3000 },
    trigger_reasons: ['ICD-10 incompatible pair: J06.9+36.1 — URI does not warrant cardiac bypass'],
    m2_validation: {
      coverage_results: [
        { rule_name: 'policy_active_check', passed: true, message: 'Policy active', details: {} },
        { rule_name: 'waiting_period_check', passed: true, message: 'Waiting period satisfied', details: {} },
        { rule_name: 'exclusion_check', passed: true, message: 'No exclusions', details: {} },
        { rule_name: 'room_rent_check', passed: true, message: 'Room rent within limit', details: {} },
        { rule_name: 'copay_calculation', passed: true, message: 'Co-pay: 10% = ₹28,500', details: { copay_amount_inr: 28500, insurer_pays_inr: 256500 } },
        { rule_name: 'sum_insured_check', passed: true, message: 'Within sum insured', details: {} },
      ],
      code_results: [
        { code: 'J06.9', is_valid: true, description: 'Acute upper respiratory infection' },
        { code: '36.1', is_valid: true, description: 'CABG surgery' },
        { code: 'J06.9+36.1', is_valid: false, warnings: ['URI does not warrant cardiac bypass surgery'] },
      ],
    },
    adjudicator_summary: '## Recommendation\n**REVIEW REQUIRED** — Incompatible diagnosis-procedure pair detected. J06.9 (URI) + 36.1 (CABG) is clinically inconsistent.',
    timeline: [
      { label: 'Documents Received', completed: true, time: '9:15 AM' },
      { label: 'AI Extraction (M1)', completed: true, time: '9:16 AM' },
      { label: 'Policy Validation (M2)', completed: true, time: '9:17 AM' },
      { label: 'Human Review', active: true, time: 'Awaiting' },
      { label: 'Final Package (M3)', completed: false },
    ],
  },
  {
    claim_id: 'CS-2026-0044',
    patient_name: 'Amit Patel',
    hospital: 'Max Hospital, Delhi',
    total: 135000,
    status: 'Approved',
    admission_date: '2026-02-25',
    discharge_date: '2026-02-28',
    policy_number: 'HDFC-2025-456',
    pre_auth: 'PA-2026-0044',
    billing: { room: 20000, icu: 0, ot: 30000, medicines: 25000, diagnostics: 15000, other: 5000 },
    m2_validation: {
      coverage_results: [
        { rule_name: 'policy_active_check', passed: true, message: 'Policy active', details: {} },
        { rule_name: 'waiting_period_check', passed: true, message: 'Waiting period satisfied', details: {} },
        { rule_name: 'exclusion_check', passed: true, message: 'No exclusions', details: {} },
        { rule_name: 'room_rent_check', passed: true, message: 'Room rent within limit', details: {} },
        { rule_name: 'copay_calculation', passed: true, message: 'Co-pay: 10% = ₹13,500', details: { copay_amount_inr: 13500, insurer_pays_inr: 121500 } },
        { rule_name: 'sum_insured_check', passed: true, message: 'Within sum insured', details: {} },
      ],
      code_results: [
        { code: 'K80.2', is_valid: true, description: 'Calculus of gallbladder' },
        { code: '51.22', is_valid: true, description: 'Laparoscopic cholecystectomy' },
      ],
    },
    adjudicator_summary: '## Recommendation\n**APPROVE** — All coverage checks passed. Laparoscopic cholecystectomy for gallstone is clinically appropriate. 3-day stay is within surgical guidelines.',
    submission: { reference_number: 'INS-2026-847291', status: 'Approved', estimated_response: 'Approved' },
    timeline: [
      { label: 'Documents Received', completed: true, time: 'Feb 25, 9:00 AM' },
      { label: 'AI Extraction', completed: true, time: '9:01 AM' },
      { label: 'Policy Validation', completed: true, time: '9:02 AM' },
      { label: 'Auto-Approved', completed: true, time: '9:02 AM' },
      { label: 'FHIR Package Built', completed: true, time: '9:03 AM' },
      { label: 'Submitted & Approved', completed: true, time: '9:45 AM' },
    ],
  },
  {
    claim_id: 'CS-2026-0051',
    patient_name: 'Meena Reddy',
    hospital: 'KIMS Hospital, Hyderabad',
    total: 175000,
    status: 'Denied',
    admission_date: '2026-03-05',
    discharge_date: '2026-03-07',
    policy_number: 'SBI-2025-333',
    pre_auth: null,
    billing: { room: 12000, icu: 0, ot: 0, medicines: 15000, diagnostics: 8000, other: 2000 },
    trigger_reasons: ['Coverage check failed — exclusion_check: Pre-existing condition excluded'],
    m2_validation: {
      coverage_results: [
        { rule_name: 'policy_active_check', passed: true, message: 'Policy active', details: {} },
        { rule_name: 'exclusion_check', passed: false, message: 'Pre-existing diabetes (E11.9) excluded under policy terms', details: {} },
        { rule_name: 'pre_auth_check', passed: false, message: 'No pre-authorization number provided', details: {} },
      ],
      code_results: [
        { code: 'E11.9', is_valid: true, description: 'Type 2 diabetes mellitus' },
      ],
    },
    adjudicator_summary: '## Recommendation\n**DENIED** — Pre-existing condition (Type 2 diabetes, E11.9) excluded under policy terms. No pre-authorization obtained.',
    timeline: [
      { label: 'Documents Received', completed: true, time: 'Mar 5' },
      { label: 'Policy Validation', completed: true, time: 'Mar 5' },
      { label: 'Human Review', completed: true, time: 'Mar 5' },
      { label: 'Denied', completed: true, time: 'Mar 5, 3:22 PM' },
    ],
  },
  {
    claim_id: 'CS-2026-0055',
    patient_name: 'Suresh Iyer',
    hospital: 'Manipal Hospital, Bangalore',
    total: 420000,
    status: 'Submitted',
    admission_date: '2026-03-08',
    discharge_date: '2026-03-12',
    policy_number: 'STAR-2025-777',
    pre_auth: 'PA-2026-0055',
    billing: { room: 30000, icu: 50000, ot: 40000, medicines: 30000, diagnostics: 20000, other: 10000 },
    m2_validation: {
      coverage_results: [
        { rule_name: 'policy_active_check', passed: true, message: 'Policy active', details: {} },
        { rule_name: 'waiting_period_check', passed: true, message: 'Waiting period satisfied', details: {} },
        { rule_name: 'exclusion_check', passed: true, message: 'No exclusions', details: {} },
        { rule_name: 'room_rent_check', passed: true, message: 'Room rent within limit', details: {} },
        { rule_name: 'copay_calculation', passed: true, message: 'Co-pay: 10% = ₹42,000', details: { copay_amount_inr: 42000, insurer_pays_inr: 378000 } },
        { rule_name: 'sum_insured_check', passed: true, message: 'Within sum insured ₹10,00,000', details: {} },
      ],
      code_results: [
        { code: 'I21.9', is_valid: true, description: 'Acute MI unspecified' },
        { code: '36.06', is_valid: true, description: 'PCI/Angioplasty' },
      ],
    },
    adjudicator_summary: '## Recommendation\n**APPROVE** — All checks passed. PCI for acute MI is standard of care.',
    submission: { reference_number: 'INS-2026-392047', status: 'Under Review', estimated_response: 'within 3 hours (IRDAI cashless mandate)' },
    timeline: [
      { label: 'Documents Received', completed: true, time: 'Mar 8' },
      { label: 'AI Extraction', completed: true, time: 'Mar 8' },
      { label: 'Policy Validation', completed: true, time: 'Mar 8' },
      { label: 'Auto-Approved', completed: true, time: 'Mar 8' },
      { label: 'Submitted to Insurer', active: true, time: 'Mar 8, 11:15 AM' },
    ],
  },
]
