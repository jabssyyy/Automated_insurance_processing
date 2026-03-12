import React from 'react';
import { Clock, CheckCircle2, AlertCircle, AlertTriangle, Circle } from 'lucide-react';

/**
 * Vertical status timeline with colored dots.
 * Blue = in progress, Green = completed, Red = action needed, Amber = warning.
 *
 * Props:
 *   events — array of { status, detail, timestamp }
 */

const STATUS_COLORS = {
  // Green — completed
  DOCUMENTS_COMPLETE: 'green',
  APPROVED: 'green',
  // Red — action needed
  DOCUMENTS_MISSING: 'red',
  DENIED: 'red',
  QUERY_RAISED: 'red',
  // Amber — warning / escalation
  UNDER_HUMAN_REVIEW: 'amber',
  ESCALATED_TO_IRDAI: 'amber',
  // Blue — in progress (default)
  POLICY_VALIDATING: 'blue',
  ICD_CHECK_RUNNING: 'blue',
  ASSEMBLING_PACKAGE: 'blue',
  SUBMITTED: 'blue',
  UNDER_INSURER_REVIEW: 'blue',
};

const DOT_STYLES = {
  green: 'bg-green-500 ring-green-100',
  red:   'bg-red-500 ring-red-100',
  amber: 'bg-amber-500 ring-amber-100',
  blue:  'bg-blue-500 ring-blue-100',
};

const ICON_MAP = {
  green: CheckCircle2,
  red:   AlertCircle,
  amber: AlertTriangle,
  blue:  Circle,
};

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatStatus(s) {
  return (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function StatusTimeline({ events = [] }) {
  if (events.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-blue-500" />
          Status Timeline
        </h3>
        <p className="text-sm text-slate-400 italic">No status updates yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
      <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
        <Clock className="w-5 h-5 text-blue-500" />
        Status Timeline
      </h3>

      <div className="relative space-y-6">
        {/* Vertical line */}
        <div className="absolute left-[11px] top-3 bottom-3 w-0.5 bg-slate-100" />

        {events.map((evt, idx) => {
          const color = STATUS_COLORS[evt.status] || 'blue';
          const dotClass = DOT_STYLES[color];
          const isLatest = idx === 0;

          return (
            <div key={idx} className="relative pl-9 animate-fade-in" style={{ animationDelay: `${idx * 60}ms` }}>
              {/* Dot */}
              <div
                className={`absolute left-0 top-0.5 w-6 h-6 rounded-full ring-4 z-10 ${dotClass} ${
                  isLatest ? 'animate-pulse-dot' : ''
                }`}
              />

              {/* Content */}
              <div>
                <p className={`text-sm font-bold ${isLatest ? 'text-slate-900' : 'text-slate-600'}`}>
                  {formatStatus(evt.status)}
                </p>
                {evt.detail && (
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{evt.detail}</p>
                )}
                <p className="text-[11px] text-slate-400 mt-1 font-medium">{timeAgo(evt.timestamp)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
