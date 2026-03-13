/**
 * ClaimDocUpload — Individual named document upload slots for claim submission.
 *
 * 9 named slots (3 mandatory, 6 optional) + CKYC text input.
 * Validates mandatory docs + file integrity before allowing submission.
 */

import React, { useState, useRef } from 'react'
import {
  Upload, FileText, CheckCircle2, XCircle, AlertCircle,
  Loader2, Trash2, UploadCloud, ShieldCheck, Zap
} from 'lucide-react'

const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png']

const DOCUMENT_SLOTS = [
  { key: 'claim_form', name: 'Duly Filled & Signed Claim Form', purpose: "Insurer's own format", mandatory: true },
  { key: 'discharge_summary', name: 'Original Hospital Discharge Summary', purpose: 'Shows diagnosis, treatment, dates', mandatory: true },
  { key: 'hospital_bills', name: 'Original Hospital Bills (Itemised)', purpose: 'Every charge broken down line by line', mandatory: true },
  { key: 'payment_receipts', name: 'Original Payment Receipts', purpose: 'Proof of payment made', mandatory: false },
  { key: 'investigation_reports', name: 'All Investigation Reports', purpose: 'Lab reports, X-rays, MRI, ECG, scans', mandatory: false },
  { key: 'consultation_notes', name: "Doctor's Consultation Notes", purpose: 'Clinical history, treatment prescribed', mandatory: false },
  { key: 'pharmacy_bills', name: 'Pharmacy Bills + Prescriptions', purpose: "Medicine purchases with doctor's prescription", mandatory: false },
  { key: 'policy_document', name: 'Policy Document / Insurance Card', purpose: 'Proof of active coverage', mandatory: false },
  { key: 'photo_id', name: 'Photo ID of Patient', purpose: 'Aadhaar, PAN, Passport etc.', mandatory: false },
]


function DocumentSlot({ slot, file, error, onFileSelect, onRemove }) {
  const inputRef = useRef(null)
  const hasFile = !!file
  const hasError = !!error

  const handleChange = (e) => {
    const f = e.target.files?.[0]
    if (f) {
      if (!ACCEPTED_TYPES.includes(f.type)) {
        return // silently ignore non-accepted types
      }
      onFileSelect(slot.key, f)
    }
    e.target.value = ''
  }

  return (
    <div
      className={`relative p-4 rounded-xl border-2 transition-all duration-200 ${
        hasError
          ? 'border-red-300 bg-red-50/50'
          : hasFile
            ? 'border-green-300 bg-green-50/30'
            : slot.mandatory
              ? 'border-red-200 bg-white hover:border-red-300'
              : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-sm font-semibold text-slate-800">{slot.name}</p>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
              slot.mandatory
                ? 'bg-red-100 text-red-700'
                : 'bg-slate-100 text-slate-500'
            }`}>
              {slot.mandatory ? '🔴 MANDATORY' : '⚪ OPTIONAL'}
            </span>
          </div>
          <p className="text-xs text-slate-500">{slot.purpose}</p>
        </div>
        {hasFile && (
          <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
        )}
      </div>

      {/* File display or upload prompt */}
      {hasFile ? (
        <div className="flex items-center gap-2 mt-2 p-2.5 rounded-lg bg-green-50 border border-green-200">
          <FileText className="w-4 h-4 text-green-600 shrink-0" />
          <span className="flex-1 text-xs text-green-800 font-medium truncate">
            {file.name}
          </span>
          <span className="text-[10px] text-green-600">
            {(file.size / 1024).toFixed(0)} KB
          </span>
          <button
            onClick={() => onRemove(slot.key)}
            className="p-1 rounded-md hover:bg-red-100 text-slate-400 hover:text-red-600 transition-colors"
            title="Remove file"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 mt-2 p-3 rounded-lg
            border border-dashed border-slate-300 text-slate-500 hover:border-blue-400
            hover:text-blue-600 hover:bg-blue-50/50 transition-all text-xs font-medium"
        >
          <UploadCloud className="w-4 h-4" />
          Click to upload (PDF, JPG, PNG)
        </button>
      )}

      {/* Error message */}
      {hasError && (
        <div className="flex items-center gap-1.5 mt-2 text-xs text-red-600 font-medium">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  )
}


export default function ClaimDocUpload({ claimId, onSubmit, submitting }) {
  const [files, setFiles] = useState({})    // { slot_key: File }
  const [errors, setErrors] = useState({})  // { slot_key: "error msg" }
  const [ckycNumber, setCkycNumber] = useState('')

  const handleFileSelect = (key, file) => {
    setFiles(prev => ({ ...prev, [key]: file }))
    // Clear error for this slot
    setErrors(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const handleRemove = (key) => {
    setFiles(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const validate = () => {
    const newErrors = {}
    let valid = true

    // Check mandatory docs
    for (const slot of DOCUMENT_SLOTS) {
      if (slot.mandatory && !files[slot.key]) {
        newErrors[slot.key] = 'This document is required to proceed.'
        valid = false
      }
    }

    // Check file integrity (0 bytes / unreadable)
    for (const [key, file] of Object.entries(files)) {
      if (file.size === 0) {
        newErrors[key] = 'This file appears to be empty or unreadable. Please re-upload.'
        valid = false
      }
    }

    setErrors(newErrors)
    return valid
  }

  const handleSubmit = () => {
    if (!validate()) return

    // Collect all files for upload
    const allFiles = Object.entries(files).map(([key, file]) => ({
      slotKey: key,
      file,
    }))

    onSubmit(allFiles, ckycNumber)
  }

  const mandatoryDone = DOCUMENT_SLOTS
    .filter(s => s.mandatory)
    .every(s => files[s.key] && files[s.key].size > 0)

  const totalUploaded = Object.keys(files).length

  return (
    <div className="space-y-5">
      {/* Progress bar */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Upload className="w-4 h-4 text-blue-500" />
            Upload Documents
          </h3>
          <span className="text-xs text-slate-500">
            {totalUploaded} / {DOCUMENT_SLOTS.length} uploaded
          </span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-2">
          <div
            className="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full transition-all duration-500"
            style={{ width: `${(totalUploaded / DOCUMENT_SLOTS.length) * 100}%` }}
          />
        </div>
        {!mandatoryDone && (
          <p className="text-[11px] text-red-500 mt-2 font-medium">
            ⚠ Upload all 3 mandatory documents to submit
          </p>
        )}
      </div>

      {/* Mandatory section */}
      <div>
        <h4 className="text-xs font-bold text-red-600 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" />
          Mandatory Documents
        </h4>
        <div className="space-y-3">
          {DOCUMENT_SLOTS.filter(s => s.mandatory).map(slot => (
            <DocumentSlot
              key={slot.key}
              slot={slot}
              file={files[slot.key]}
              error={errors[slot.key]}
              onFileSelect={handleFileSelect}
              onRemove={handleRemove}
            />
          ))}
        </div>
      </div>

      {/* Optional section */}
      <div>
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5" />
          Optional Documents
        </h4>
        <div className="space-y-3">
          {DOCUMENT_SLOTS.filter(s => !s.mandatory).map(slot => (
            <DocumentSlot
              key={slot.key}
              slot={slot}
              file={files[slot.key]}
              error={errors[slot.key]}
              onFileSelect={handleFileSelect}
              onRemove={handleRemove}
            />
          ))}
        </div>
      </div>

      {/* CKYC Number */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center gap-2 mb-2">
          <label className="text-sm font-semibold text-slate-700">
            CKYC Number
          </label>
          <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
            ⚪ OPTIONAL
          </span>
        </div>
        <p className="text-xs text-slate-500 mb-2">As per IRDAI 2024 rules</p>
        <input
          type="text"
          value={ckycNumber}
          onChange={(e) => setCkycNumber(e.target.value)}
          placeholder="Enter CKYC number (if available)"
          className="w-full text-sm px-4 py-2.5 rounded-lg border border-slate-200
            focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
        />
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full flex items-center justify-center gap-2.5 py-4 px-6 rounded-xl
          bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800
          text-white text-sm font-semibold shadow-lg shadow-blue-200/50 transition-all
          duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-xl"
      >
        {submitting ? (
          <><Loader2 className="w-5 h-5 animate-spin" /> Processing Claim…</>
        ) : (
          <><Zap className="w-5 h-5" /> Submit Claim</>
        )}
      </button>
    </div>
  )
}
