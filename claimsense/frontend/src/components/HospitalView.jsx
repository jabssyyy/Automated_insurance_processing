/**
 * HospitalView — Hospital Staff Portal for Cashless Claims.
 *
 * Two paths to create a claim:
 *   Tab 1: Upload Bill → Gemini extracts → auto-fill form → review → submit
 *   Tab 2: Manual Entry → fill form → review → submit
 *
 * On submit → creates claim → runs pipeline → stores AI dual outputs
 */

import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2, LogOut, Upload, FileText, Plus, Trash2, Loader2,
  CheckCircle2, AlertCircle, ClipboardList, PenLine, Eye,
  ArrowLeft, ArrowRight, Zap, ShieldCheck, DollarSign, RefreshCw
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth.jsx'
import { useSSE } from '../hooks/useSSE.jsx'
import {
  getClaims, getTimeline, createClaim, runPipeline,
  uploadDocuments, extractBillData
} from '../services/api.jsx'
import StatusTimeline from './StatusTimeline'
import NotificationPanel from './NotificationPanel'
import StatusToast from './StatusToast'

// ── Status chip colors ──────────────────────────────────────────────
const STATUS_CHIP = {
  DOCUMENTS_MISSING:  'bg-amber-100 text-amber-700',
  DOCUMENTS_COMPLETE: 'bg-green-100 text-green-700',
  POLICY_VALIDATING:  'bg-blue-100 text-blue-700',
  APPROVED:           'bg-emerald-100 text-emerald-700',
  DENIED:             'bg-rose-100 text-rose-700',
  UNDER_HUMAN_REVIEW: 'bg-purple-100 text-purple-700',
  SUBMITTED:          'bg-indigo-100 text-indigo-700',
  ASSEMBLING_PACKAGE: 'bg-cyan-100 text-cyan-700',
}

const DEMO_POLICIES = [
  { number: 'STAR-HEALTH-2025-001', name: 'Star Comprehensive' },
  { number: 'HDFC-ERGO-2025-042', name: 'HDFC Ergo Optima' },
  { number: 'ICICI-LOMBARD-2025-77', name: 'ICICI Lombard iHealth' },
]

function formatStatus(s) {
  return (s || '').replace(/_/g, ' ')
}


// ── Claim Form Fields ───────────────────────────────────────────────

function ClaimForm({ formData, setFormData, readOnly = false }) {
  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const addChargeRow = () => {
    setFormData(prev => ({
      ...prev,
      charges: [...(prev.charges || []), { description: '', amount: '' }],
    }))
  }

  const updateCharge = (idx, field, value) => {
    setFormData(prev => {
      const charges = [...(prev.charges || [])]
      charges[idx] = { ...charges[idx], [field]: value }
      return { ...prev, charges }
    })
  }

  const removeCharge = (idx) => {
    setFormData(prev => ({
      ...prev,
      charges: (prev.charges || []).filter((_, i) => i !== idx),
    }))
  }

  const totalAmount = (formData.charges || []).reduce(
    (sum, c) => sum + (parseFloat(c.amount) || 0), 0
  )

  const inputClass = `w-full text-sm px-3 py-2.5 rounded-lg border border-slate-200 
    focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400
    ${readOnly ? 'bg-slate-50 cursor-not-allowed' : 'bg-white'}`

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold text-slate-600 mb-1 block">Patient Name *</label>
          <input className={inputClass} value={formData.patientName || ''} readOnly={readOnly}
            onChange={e => updateField('patientName', e.target.value)} placeholder="Full name" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600 mb-1 block">Patient ID</label>
          <input className={inputClass} value={formData.patientId || ''} readOnly={readOnly}
            onChange={e => updateField('patientId', e.target.value)} placeholder="ID number" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600 mb-1 block">Hospital Name *</label>
          <input className={inputClass} value={formData.hospitalName || ''} readOnly={readOnly}
            onChange={e => updateField('hospitalName', e.target.value)} placeholder="Hospital" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600 mb-1 block">Treating Doctor *</label>
          <input className={inputClass} value={formData.doctorName || ''} readOnly={readOnly}
            onChange={e => updateField('doctorName', e.target.value)} placeholder="Dr." />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600 mb-1 block">Diagnosis / Procedure *</label>
          <input className={inputClass} value={formData.diagnosis || ''} readOnly={readOnly}
            onChange={e => updateField('diagnosis', e.target.value)} placeholder="e.g. Appendectomy" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600 mb-1 block">Policy Number *</label>
          <select className={inputClass} value={formData.policyNumber || ''} disabled={readOnly}
            onChange={e => updateField('policyNumber', e.target.value)}>
            <option value="">Select policy</option>
            {DEMO_POLICIES.map(p => (
              <option key={p.number} value={p.number}>{p.number} — {p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600 mb-1 block">Date of Admission *</label>
          <input type="date" className={inputClass} value={formData.admissionDate || ''} readOnly={readOnly}
            onChange={e => updateField('admissionDate', e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600 mb-1 block">Date of Discharge *</label>
          <input type="date" className={inputClass} value={formData.dischargeDate || ''} readOnly={readOnly}
            onChange={e => updateField('dischargeDate', e.target.value)} />
        </div>
      </div>

      {/* Itemised Charges */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5" /> Itemised Charges
          </label>
          {!readOnly && (
            <button onClick={addChargeRow}
              className="text-xs text-teal-600 font-semibold hover:text-teal-700 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add Item
            </button>
          )}
        </div>
        <div className="space-y-2">
          {(formData.charges || []).map((charge, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input className={`flex-1 ${inputClass}`} value={charge.description} readOnly={readOnly}
                onChange={e => updateCharge(idx, 'description', e.target.value)} placeholder="Description" />
              <input className={`w-28 ${inputClass}`} type="number" value={charge.amount} readOnly={readOnly}
                onChange={e => updateCharge(idx, 'amount', e.target.value)} placeholder="₹ Amount" />
              {!readOnly && (
                <button onClick={() => removeCharge(idx)}
                  className="p-2 text-slate-400 hover:text-red-500 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <div className="bg-teal-50 border border-teal-200 rounded-lg px-4 py-2">
            <span className="text-xs text-teal-600 font-medium">Total: </span>
            <span className="text-sm font-bold text-teal-800">₹{totalAmount.toLocaleString('en-IN')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}


// ── Main HospitalView ───────────────────────────────────────────────

export default function HospitalView() {
  const { token, logout } = useAuth()
  const navigate = useNavigate()
  const { latestEvent } = useSSE(token)
  const fileInputRef = useRef(null)

  // View state
  const [view, setView] = useState('list') // 'list' | 'create' | 'review'

  // Create flow state
  const [mode, setMode] = useState('upload') // 'upload' | 'manual'
  const [uploadFile, setUploadFile] = useState(null)
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState(null)
  const [formData, setFormData] = useState({
    patientName: '', patientId: '', hospitalName: '', doctorName: '',
    diagnosis: '', policyNumber: '', admissionDate: '', dischargeDate: '',
    charges: [{ description: '', amount: '' }],
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [submitSuccess, setSubmitSuccess] = useState(null)

  // Claims list
  const [claims, setClaims] = useState([])
  const [selectedClaim, setSelectedClaim] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [timeline, setTimeline] = useState([])

  // Fetch claims
  const refreshClaims = async () => {
    setRefreshing(true)
    try {
      const res = await getClaims()
      const list = res.data?.claims || []
      setClaims(list)
    } catch {
      setClaims([])
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    refreshClaims()
  }, [submitSuccess])

  // Fetch timeline for selected claim
  useEffect(() => {
    if (!selectedClaim) return
    ;(async () => {
      try {
        const res = await getTimeline(selectedClaim.claim_id)
        setTimeline(res.data?.timeline || [])
      } catch {
        setTimeline([])
      }
    })()
  }, [selectedClaim])

  // SSE live updates
  useEffect(() => {
    if (!latestEvent) return
    setClaims(prev =>
      prev.map(c =>
        c.claim_id === latestEvent.claim_id
          ? { ...c, current_status: latestEvent.status }
          : c
      )
    )
    if (selectedClaim?.claim_id === latestEvent.claim_id) {
      setSelectedClaim(prev => prev ? { ...prev, current_status: latestEvent.status } : prev)
      setTimeline(prev => [
        { status: latestEvent.status, detail: latestEvent.detail, timestamp: latestEvent.timestamp },
        ...prev,
      ])
    }
  }, [latestEvent])

  // ── Upload handler ────────────────────────────────────────────────
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadFile(file)
    setExtracting(true)
    setExtractError(null)

    try {
      const res = await extractBillData(file)
      const data = res.data?.extracted || {}

      // Map extracted data to form
      setFormData(prev => ({
        ...prev,
        patientName: data.patient_name || prev.patientName,
        patientId: data.patient_id || prev.patientId,
        hospitalName: data.hospital_name || prev.hospitalName,
        doctorName: data.doctor_name || prev.doctorName,
        diagnosis: (data.diagnosis_codes || []).map(c =>
          typeof c === 'object' ? c.description || c.code : c
        ).join(', ') || prev.diagnosis,
        admissionDate: data.admission_date || prev.admissionDate,
        dischargeDate: data.discharge_date || prev.dischargeDate,
        charges: (data.billing_items || []).length > 0
          ? data.billing_items.map(item => ({
              description: item.item_name || item.item || item.description || '',
              amount: String(item.amount || ''),
            }))
          : prev.charges,
      }))

      if (!res.data?.success) {
        const backendError = res.data?.error || ''
        if (backendError.toLowerCase().includes('quota') || backendError.includes('429')) {
          setExtractError('Gemini AI quota exhausted. The form fields could not be auto-filled. Please enter the details manually or add a backup API key in .env.')
        } else {
          setExtractError('AI extraction could not fully process the document. Please review and complete the fields manually.')
        }
      }
    } catch (err) {
      setExtractError('Failed to connect to the extraction service. Please fill in the form manually.')
    } finally {
      setExtracting(false)
    }
  }

  // ── Submit handler ────────────────────────────────────────────────
  const handleSubmit = async () => {
    // Validate required fields
    const required = ['patientName', 'hospitalName', 'doctorName', 'diagnosis', 'policyNumber', 'admissionDate', 'dischargeDate']
    const missing = required.filter(f => !formData[f])
    if (missing.length > 0) {
      setSubmitError(`Please fill in: ${missing.map(f => f.replace(/([A-Z])/g, ' $1').trim()).join(', ')}`)
      return
    }

    setSubmitting(true)
    setSubmitError(null)

    try {
      // 1. Create claim
      const claimRes = await createClaim(formData.policyNumber, 'inpatient', 'cashless')
      const claimId = claimRes.data?.claim_id
      if (!claimId) throw new Error('Failed to create claim')

      // 2. Run pipeline
      await runPipeline(claimId)

      // 3. Refresh claims list
      setSubmitSuccess({
        claimId,
        message: `Cashless claim ${claimId} created and submitted for processing!`,
      })
      setView('list')

      // Reset form
      setFormData({
        patientName: '', patientId: '', hospitalName: '', doctorName: '',
        diagnosis: '', policyNumber: '', admissionDate: '', dischargeDate: '',
        charges: [{ description: '', amount: '' }],
      })
      setUploadFile(null)
    } catch (err) {
      setSubmitError(err?.response?.data?.detail || err.message || 'Failed to submit claim')
    } finally {
      setSubmitting(false)
    }
  }

  const resetForm = () => {
    setFormData({
      patientName: '', patientId: '', hospitalName: '', doctorName: '',
      diagnosis: '', policyNumber: '', admissionDate: '', dischargeDate: '',
      charges: [{ description: '', amount: '' }],
    })
    setUploadFile(null)
    setExtractError(null)
    setSubmitError(null)
    setSubmitSuccess(null)
  }

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-teal-600 to-teal-700 rounded-lg flex items-center justify-center shadow-lg shadow-teal-100">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">ClaimSense</h1>
            <span className="text-xs text-slate-400 font-medium">Hospital Portal</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <NotificationPanel />
          <button
            onClick={refreshClaims}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-teal-600 px-3 py-2 rounded-lg hover:bg-teal-50 transition-colors disabled:opacity-50"
            title="Refresh claims"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => { resetForm(); setView('create') }}
            className="flex items-center gap-1.5 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 px-4 py-2 rounded-lg transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" /> New Cashless Claim
          </button>
          <button onClick={handleLogout}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-red-500 px-3 py-2 rounded-lg hover:bg-red-50 transition-colors">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Success banner */}
      {submitSuccess && (
        <div className="bg-green-50 border-b border-green-200 px-6 py-3 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          <span className="text-sm font-medium text-green-800">{submitSuccess.message}</span>
          <button onClick={() => setSubmitSuccess(null)} className="ml-auto text-green-600 hover:text-green-800 text-xs font-semibold">
            Dismiss
          </button>
        </div>
      )}

      {/* ── CREATE VIEW ───────────────────────────────────────────── */}
      {view === 'create' && (
        <div className="max-w-3xl mx-auto py-8 px-6">
          {/* Back button */}
          <button onClick={() => setView('list')}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to Claims
          </button>

          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-500 to-teal-700 shadow-xl shadow-teal-200/50 mb-3">
              <ClipboardList className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900">New Cashless Claim</h2>
            <p className="text-slate-500 mt-1 text-sm">Upload a bill for AI extraction or enter details manually</p>
          </div>

          {/* Mode Toggle */}
          <div className="flex bg-slate-100 rounded-xl p-1 mb-6">
            <button
              onClick={() => setMode('upload')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                mode === 'upload'
                  ? 'bg-white text-teal-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Upload className="w-4 h-4" /> Upload Bill
            </button>
            <button
              onClick={() => setMode('manual')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                mode === 'manual'
                  ? 'bg-white text-teal-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <PenLine className="w-4 h-4" /> Manual Entry
            </button>
          </div>

          {/* Upload Zone (Upload mode only) */}
          {mode === 'upload' && (
            <div className="mb-6">
              {!uploadFile ? (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full p-8 border-2 border-dashed border-teal-300 rounded-2xl bg-teal-50/50
                    hover:border-teal-400 hover:bg-teal-50 transition-all flex flex-col items-center gap-3"
                >
                  <Upload className="w-10 h-10 text-teal-400" />
                  <div>
                    <p className="text-sm font-semibold text-teal-700">Click to upload hospital bill</p>
                    <p className="text-xs text-teal-500 mt-1">PDF, JPG, or PNG • AI will auto-extract details</p>
                  </div>
                </button>
              ) : (
                <div className="p-4 bg-teal-50 border border-teal-200 rounded-xl">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-teal-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-teal-800 truncate">{uploadFile.name}</p>
                      <p className="text-xs text-teal-600">{(uploadFile.size / 1024).toFixed(0)} KB</p>
                    </div>
                    {extracting ? (
                      <div className="flex items-center gap-2 text-teal-600">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-xs font-medium">Extracting details from document…</span>
                      </div>
                    ) : (
                      <button onClick={() => { setUploadFile(null); resetForm() }}
                        className="text-sm text-red-500 hover:text-red-700 font-medium">
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                onChange={handleFileUpload} />

              {extractError && (
                <div className="mt-3 flex items-center gap-2 bg-amber-50 border border-amber-200 px-4 py-2.5 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="text-xs text-amber-700">{extractError}</span>
                </div>
              )}
            </div>
          )}

          {/* Form */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-6">
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-teal-500" />
              Claim Details
              {mode === 'upload' && uploadFile && !extracting && (
                <span className="text-[10px] bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-bold">
                  AI auto-filled — review & edit
                </span>
              )}
            </h3>
            <ClaimForm formData={formData} setFormData={setFormData} />
          </div>

          {/* Error */}
          {submitError && (
            <div className="mb-4 flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" /> {submitError}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={() => setView('review')}
            disabled={extracting}
            className="w-full flex items-center justify-center gap-2.5 py-3.5 px-6 rounded-xl
              bg-gradient-to-r from-teal-600 to-teal-700 hover:from-teal-700 hover:to-teal-800
              text-white text-sm font-semibold shadow-lg shadow-teal-200/50 transition-all
              duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-xl"
          >
            <Eye className="w-5 h-5" /> Review & Submit
          </button>
        </div>
      )}

      {/* ── REVIEW VIEW ──────────────────────────────────────────── */}
      {view === 'review' && (
        <div className="max-w-3xl mx-auto py-8 px-6">
          <button onClick={() => setView('create')}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to Edit
          </button>

          <div className="text-center mb-6">
            <h2 className="text-xl font-bold text-slate-900">Review Claim Details</h2>
            <p className="text-slate-500 mt-1 text-sm">Verify all information before submitting</p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-6">
            <ClaimForm formData={formData} setFormData={setFormData} readOnly={true} />
          </div>

          {submitError && (
            <div className="mb-4 flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" /> {submitError}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2.5 py-4 px-6 rounded-xl
              bg-gradient-to-r from-teal-600 to-teal-700 hover:from-teal-700 hover:to-teal-800
              text-white text-sm font-semibold shadow-lg shadow-teal-200/50 transition-all
              duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-xl"
          >
            {submitting ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> Submitting Claim…</>
            ) : (
              <><Zap className="w-5 h-5" /> Submit Cashless Claim</>
            )}
          </button>
        </div>
      )}

      {/* ── LIST VIEW ────────────────────────────────────────────── */}
      {view === 'list' && (
        <div className="flex h-[calc(100vh-65px)]">
          {/* Sidebar — Claims list */}
          <aside className="w-[30%] border-r border-slate-200 bg-white overflow-y-auto">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <Building2 className="w-4 h-4 text-slate-400" /> Active Claims
              </h2>
              <span className="text-xs text-slate-400 font-medium">{claims.length} total</span>
            </div>
            <div className="divide-y divide-slate-50">
              {claims.length === 0 && (
                <div className="p-8 text-center text-sm text-slate-400">
                  No claims yet. Click "New Cashless Claim" to get started.
                </div>
              )}
              {claims.map(claim => (
                <div
                  key={claim.claim_id}
                  onClick={() => setSelectedClaim(claim)}
                  className={`p-4 cursor-pointer transition-colors hover:bg-teal-50/30 ${
                    selectedClaim?.claim_id === claim.claim_id ? 'bg-teal-50 border-l-4 border-teal-600' : ''
                  }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <h3 className="font-bold text-slate-800 text-sm">
                      {claim.claim_json?.patient_name || claim.patient_name || 'Patient'}
                    </h3>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                      STATUS_CHIP[claim.current_status] || 'bg-gray-100 text-gray-700'
                    }`}>
                      {formatStatus(claim.current_status)}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1 space-y-0.5">
                    <div className="flex justify-between">
                      <span className="font-mono">{claim.claim_id}</span>
                      <span className="font-semibold">{claim.total_amount ? `₹${Number(claim.total_amount).toLocaleString('en-IN')}` : '—'}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>{claim.path === 'cashless' ? 'Cashless' : 'Reimbursement'}</span>
                      <span>{claim.created_at ? new Date(claim.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </aside>

          {/* Main content — Claim detail */}
          <main className="flex-1 overflow-y-auto p-6 pb-24">
            {selectedClaim ? (
              <div className="max-w-4xl mx-auto animate-fade-in">
                {/* Overview Card */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6 flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-teal-50 rounded-xl flex items-center justify-center">
                      <Building2 className="w-7 h-7 text-teal-500" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-slate-800">
                        {selectedClaim.claim_json?.patient_name || selectedClaim.patient_name || 'Patient'}
                      </h2>
                      <p className="text-sm text-slate-500 mt-0.5">
                        {selectedClaim.claim_id} · {selectedClaim.claim_type || 'inpatient'} · {selectedClaim.path || 'cashless'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500 font-medium mb-1">Status</p>
                    <span className={`text-sm px-3 py-1 rounded-full font-bold ${
                      STATUS_CHIP[selectedClaim.current_status] || 'bg-gray-100 text-gray-700'
                    }`}>
                      {formatStatus(selectedClaim.current_status)}
                    </span>
                  </div>
                </div>

                {/* Claim Details */}
                {selectedClaim.claim_json && (
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6">
                    <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                      <FileText className="w-5 h-5 text-teal-500" /> Claim Details
                    </h3>
                    <dl className="grid grid-cols-2 gap-4 text-sm">
                      {[
                        { label: 'Hospital', value: selectedClaim.claim_json.hospital_name },
                        { label: 'Doctor', value: selectedClaim.claim_json.doctor_name },
                        { label: 'Admission', value: selectedClaim.claim_json.admission_date },
                        { label: 'Discharge', value: selectedClaim.claim_json.discharge_date },
                        { label: 'Policy', value: selectedClaim.policy_number },
                        { label: 'Amount', value: selectedClaim.total_amount ? `₹${Number(selectedClaim.total_amount).toLocaleString('en-IN')}` : '—' },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <dt className="text-xs text-slate-400 font-medium">{label}</dt>
                          <dd className="text-sm text-slate-800 font-semibold mt-0.5">{value || '—'}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}

                {/* Timeline */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                  <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-teal-600" /> Claim Timeline
                  </h3>
                  <StatusTimeline timeline={timeline} />
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-400">
                <Building2 className="w-16 h-16 opacity-30 mb-4" />
                <p className="text-lg font-medium">Select a claim to view details</p>
                <p className="text-sm mt-1">Or create a new cashless claim</p>
              </div>
            )}
          </main>
        </div>
      )}
      {/* Toast notifications for status changes */}
      <StatusToast latestEvent={latestEvent} />
    </div>
  )
}
