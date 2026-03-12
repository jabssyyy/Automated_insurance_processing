import React, { useState } from 'react'

/**
 * CoverageDisplay — Dual-mode coverage results display.
 *
 * @param {Object} props
 * @param {"patient"|"insurer"} props.mode
 * @param {Object} props.m2Results - M2 validation results
 * @param {string} [props.patientSummary]
 */
export default function CoverageDisplay({ mode = 'insurer', m2Results = {}, patientSummary = '' }) {
  const coverageResults = m2Results.coverage_results || []
  const codeResults = m2Results.code_results || []

  if (mode === 'patient') {
    return <PatientMode patientSummary={patientSummary} coverageResults={coverageResults} />
  }

  return <InsurerMode coverageResults={coverageResults} codeResults={codeResults} />
}

/* ─────────────────────────────────────────────────────────
   Patient Mode — Simple, friendly view
   ───────────────────────────────────────────────────────── */

function PatientMode({ patientSummary, coverageResults }) {
  const copayRule = coverageResults.find(r => r.rule_name === 'copay_calculation')
  const copayAmount = copayRule?.details?.copay_amount_inr || 0
  const insurerPays = copayRule?.details?.insurer_pays_inr || 0

  const covered = coverageResults.filter(r => r.passed)
  const notCovered = coverageResults.filter(r => !r.passed)

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Summary */}
      {patientSummary && (
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-primary-300 uppercase tracking-wider mb-3">
            Your Coverage Summary
          </h3>
          <p className="text-surface-200 text-sm leading-relaxed whitespace-pre-line">
            {patientSummary}
          </p>
        </div>
      )}

      {/* Co-pay Box */}
      {copayRule && (
        <div className="glass-card p-5 border-primary-500/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-surface-400 uppercase tracking-wider">Your Co-pay</p>
              <p className="text-2xl font-bold text-warning mt-1">₹{copayAmount.toLocaleString('en-IN')}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-surface-400 uppercase tracking-wider">Insurer Covers</p>
              <p className="text-2xl font-bold text-success mt-1">₹{insurerPays.toLocaleString('en-IN')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Covered / Not Covered */}
      <div className="grid grid-cols-2 gap-3">
        <div className="glass-card-flat p-4">
          <h4 className="text-xs font-semibold text-success uppercase mb-2">✓ Covered</h4>
          {covered.length === 0 ? (
            <p className="text-xs text-surface-400">No items</p>
          ) : (
            <ul className="space-y-1">
              {covered.map((r, i) => (
                <li key={i} className="text-xs text-surface-300 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
                  {formatRuleName(r.rule_name)}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="glass-card-flat p-4">
          <h4 className="text-xs font-semibold text-danger uppercase mb-2">✗ Issues Found</h4>
          {notCovered.length === 0 ? (
            <p className="text-xs text-surface-400">None — all clear!</p>
          ) : (
            <ul className="space-y-1">
              {notCovered.map((r, i) => (
                <li key={i} className="text-xs text-surface-300 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-danger shrink-0" />
                  {formatRuleName(r.rule_name)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────
   Insurer Mode — Detailed rule-by-rule table
   ───────────────────────────────────────────────────────── */

function InsurerMode({ coverageResults, codeResults }) {
  const [expandedRow, setExpandedRow] = useState(null)

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Coverage Rules Table */}
      <div className="glass-card overflow-hidden">
        <div className="px-5 py-3 border-b border-surface-700/50">
          <h3 className="text-sm font-semibold text-primary-300 uppercase tracking-wider">
            Coverage Rule Results
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-700/30">
                <th className="text-left px-5 py-2.5 text-xs font-semibold text-surface-400 uppercase">Rule</th>
                <th className="text-center px-3 py-2.5 text-xs font-semibold text-surface-400 uppercase">Status</th>
                <th className="text-right px-5 py-2.5 text-xs font-semibold text-surface-400 uppercase">Details</th>
              </tr>
            </thead>
            <tbody>
              {coverageResults.map((rule, idx) => {
                const isExpanded = expandedRow === idx
                return (
                  <React.Fragment key={idx}>
                    <tr
                      className="border-b border-surface-800/50 hover:bg-surface-800/30 cursor-pointer transition-colors"
                      onClick={() => setExpandedRow(isExpanded ? null : idx)}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <svg
                            className={`w-3 h-3 text-surface-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            fill="currentColor" viewBox="0 0 20 20"
                          >
                            <path d="M6 4l8 6-8 6V4z" />
                          </svg>
                          <span className="text-surface-200 font-medium">
                            {formatRuleName(rule.rule_name)}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`badge ${rule.passed ? 'badge-pass' : 'badge-fail'}`}>
                          {rule.passed ? '✓ Pass' : '✗ Fail'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right text-xs text-surface-400 max-w-[250px] truncate">
                        {rule.message}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-surface-900/50">
                        <td colSpan={3} className="px-5 py-3">
                          <div className="pl-5 text-xs text-surface-400 space-y-1">
                            <p><span className="text-surface-300 font-medium">Message:</span> {rule.message}</p>
                            {rule.details && Object.entries(rule.details).map(([key, val]) => (
                              <p key={key}>
                                <span className="text-surface-300 font-medium">{formatRuleName(key)}:</span>{' '}
                                {typeof val === 'number' ? `₹${val.toLocaleString('en-IN')}` : String(val)}
                              </p>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ICD-10 Code Validation */}
      {codeResults.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div className="px-5 py-3 border-b border-surface-700/50">
            <h3 className="text-sm font-semibold text-primary-300 uppercase tracking-wider">
              Code Validation
            </h3>
          </div>
          <div className="p-4 grid grid-cols-2 gap-2">
            {codeResults.map((code, idx) => (
              <div
                key={idx}
                className={`flex items-center gap-2 p-2.5 rounded-lg text-xs ${
                  code.is_valid
                    ? 'bg-success/5 border border-success/20'
                    : 'bg-danger/5 border border-danger/20'
                }`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${code.is_valid ? 'bg-success' : 'bg-danger'}`} />
                <span className="font-mono font-semibold text-surface-200">{code.code}</span>
                <span className="text-surface-400 truncate">
                  {code.description || code.warnings?.join(', ') || ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────── */

function formatRuleName(name) {
  return (name || '')
    .replace(/_/g, ' ')
    .replace(/\binr\b/gi, '(INR)')
    .replace(/\b\w/g, c => c.toUpperCase())
}
