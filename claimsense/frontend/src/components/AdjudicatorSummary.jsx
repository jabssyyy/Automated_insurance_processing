import React from 'react'

/**
 * AdjudicatorSummary — Renders M3 adjudicator summary with FHIR download.
 *
 * @param {Object} props
 * @param {string} props.summary - The adjudicator summary text
 * @param {Object} [props.fhirPackage] - FHIR R4 Bundle JSON
 * @param {string} [props.fhirSummary] - Brief FHIR summary for display
 * @param {Object} [props.submission] - Submission info (reference_number, etc.)
 */
export default function AdjudicatorSummary({
  summary = '',
  fhirPackage = null,
  fhirSummary = '',
  submission = null,
}) {
  const handleDownloadFHIR = () => {
    if (!fhirPackage) return
    const blob = new Blob([JSON.stringify(fhirPackage, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `claimsense_fhir_bundle_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Submission Status */}
      {submission && (
        <div className="glass-card p-4 border-primary-500/30 pulse-glow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-surface-400 uppercase tracking-wider">Insurer Reference</p>
              <p className="text-lg font-bold text-primary-300 font-mono mt-0.5">
                {submission.reference_number || '—'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-surface-400 uppercase tracking-wider">Status</p>
              <span className="badge badge-submitted mt-1">
                {submission.status || 'Submitted'}
              </span>
            </div>
          </div>
          {submission.estimated_response && (
            <p className="text-xs text-surface-400 mt-3 pt-3 border-t border-surface-700/30">
              ⏱ Expected response: {submission.estimated_response}
            </p>
          )}
        </div>
      )}

      {/* Adjudicator Summary */}
      <div className="glass-card overflow-hidden">
        <div className="px-5 py-3 border-b border-surface-700/50 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-primary-300 uppercase tracking-wider">
            Adjudicator Summary
          </h3>
          {fhirPackage && (
            <button onClick={handleDownloadFHIR} className="btn btn-ghost text-xs py-1.5 px-3">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download FHIR Package
            </button>
          )}
        </div>

        <div className="p-5 prose-invert">
          {summary ? (
            <FormattedSummary text={summary} />
          ) : (
            <p className="text-surface-400 text-sm italic">No adjudicator summary available yet.</p>
          )}
        </div>
      </div>

      {/* FHIR Summary */}
      {fhirSummary && (
        <div className="glass-card-flat p-4">
          <p className="text-xs text-surface-400 uppercase tracking-wider mb-1">FHIR Package</p>
          <p className="text-xs text-surface-300">{fhirSummary}</p>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────
   Format adjudicator summary text into sections
   ───────────────────────────────────────────────────────── */

function FormattedSummary({ text }) {
  const lines = text.split('\n')

  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const trimmed = line.trim()
        if (!trimmed) return <div key={i} className="h-2" />

        // Markdown headers
        if (trimmed.startsWith('# ')) {
          return (
            <h3 key={i} className="text-base font-bold text-surface-100 mt-4 mb-1">
              {trimmed.replace(/^#+\s*/, '')}
            </h3>
          )
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h4 key={i} className="text-sm font-semibold text-primary-300 mt-3 mb-1 uppercase tracking-wider">
              {trimmed.replace(/^#+\s*/, '')}
            </h4>
          )
        }
        if (trimmed.startsWith('### ')) {
          return (
            <h5 key={i} className="text-sm font-medium text-surface-200 mt-2">
              {trimmed.replace(/^#+\s*/, '')}
            </h5>
          )
        }

        // Bold text
        if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
          return (
            <p key={i} className="text-sm font-semibold text-surface-100 mt-2">
              {trimmed.replace(/\*\*/g, '')}
            </p>
          )
        }

        // Bullet points
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          const content = trimmed.slice(2)
          const isPass = content.includes('PASS') || content.includes('✅')
          const isFail = content.includes('FAIL') || content.includes('❌')

          return (
            <div key={i} className="flex items-start gap-2 ml-2 text-xs text-surface-300 leading-relaxed">
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                isPass ? 'bg-success' : isFail ? 'bg-danger' : 'bg-surface-500'
              }`} />
              <span dangerouslySetInnerHTML={{ __html: formatInlineMarkdown(content) }} />
            </div>
          )
        }

        // Regular paragraph
        return (
          <p key={i} className="text-xs text-surface-300 leading-relaxed">
            <span dangerouslySetInnerHTML={{ __html: formatInlineMarkdown(trimmed) }} />
          </p>
        )
      })}
    </div>
  )
}

function formatInlineMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-surface-100 font-semibold">$1</strong>')
    .replace(/₹([\d,]+)/g, '<span class="font-mono text-primary-300 font-semibold">₹$1</span>')
}
