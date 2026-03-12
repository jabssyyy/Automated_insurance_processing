import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import useSSE from '../hooks/useSSE';
import { getClaims, getTimeline } from '../services/api';
import { LogOut, ShieldCheck, AlertTriangle, FileWarning, CheckCircle2, XCircle } from 'lucide-react';
import DocumentUpload from './DocumentUpload';
import StatusTimeline from './StatusTimeline';
import NotificationPanel from './NotificationPanel';
import ChatAssistant from './ChatAssistant';

// ── Status banner logic ─────────────────────────────────────────────
const BANNER = {
  APPROVED:           { color: 'bg-green-50 border-green-200 text-green-800', icon: CheckCircle2, iconColor: 'text-green-500', label: 'Approved' },
  DOCUMENTS_COMPLETE: { color: 'bg-green-50 border-green-200 text-green-800', icon: CheckCircle2, iconColor: 'text-green-500', label: 'Documents Complete' },
  DENIED:             { color: 'bg-red-50 border-red-200 text-red-800', icon: XCircle, iconColor: 'text-red-500', label: 'Denied' },
  DOCUMENTS_MISSING:  { color: 'bg-red-50 border-red-200 text-red-800', icon: FileWarning, iconColor: 'text-red-500', label: 'Documents Missing' },
  QUERY_RAISED:       { color: 'bg-red-50 border-red-200 text-red-800', icon: AlertTriangle, iconColor: 'text-red-500', label: 'Query Raised' },
  UNDER_HUMAN_REVIEW: { color: 'bg-amber-50 border-amber-200 text-amber-800', icon: AlertTriangle, iconColor: 'text-amber-500', label: 'Under Review' },
  ESCALATED_TO_IRDAI: { color: 'bg-amber-50 border-amber-200 text-amber-800', icon: AlertTriangle, iconColor: 'text-amber-500', label: 'Escalated to IRDAI' },
};

const DEFAULT_BANNER = { color: 'bg-blue-50 border-blue-200 text-blue-800', icon: ShieldCheck, iconColor: 'text-blue-500', label: 'In Progress' };

function getBanner(status) {
  return BANNER[status] || DEFAULT_BANNER;
}

function formatStatus(s) {
  return (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function PatientView() {
  const { logout } = useAuth();
  const { latestEvent } = useSSE();

  const [claims, setClaims] = useState([]);
  const [activeClaim, setActiveClaim] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [coverageData, setCoverageData] = useState(null);

  // Fetch claims on mount
  useEffect(() => {
    (async () => {
      try {
        const data = await getClaims();
        setClaims(data.claims || []);
        if (data.claims?.length > 0) {
          setActiveClaim(data.claims[0]);
        }
      } catch {
        // Demo fallback
        const demo = {
          claim_id: 'CS-2026-001',
          current_status: 'POLICY_VALIDATING',
          patient_name: 'Aditya Kumar',
          total_amount: 145000,
          created_at: new Date().toISOString(),
        };
        setClaims([demo]);
        setActiveClaim(demo);
      }
    })();
  }, []);

  // Fetch timeline when active claim changes
  useEffect(() => {
    if (!activeClaim) return;
    (async () => {
      try {
        const data = await getTimeline(activeClaim.claim_id);
        setTimeline(data.timeline || []);
      } catch {
        setTimeline([]);
      }
    })();
  }, [activeClaim]);

  // React to SSE events
  useEffect(() => {
    if (!latestEvent || !activeClaim) return;
    if (latestEvent.claim_id === activeClaim.claim_id) {
      // Prepend to timeline
      setTimeline((prev) => [
        { status: latestEvent.status, detail: latestEvent.detail, timestamp: latestEvent.timestamp },
        ...prev,
      ]);
      // Update active claim status
      setActiveClaim((c) => c ? { ...c, current_status: latestEvent.status } : c);
    }
  }, [latestEvent]);

  const claimId = activeClaim?.claim_id;
  const status = activeClaim?.current_status || 'UNKNOWN';
  const banner = getBanner(status);
  const BannerIcon = banner.icon;

  // Mock coverage for demo display
  const coverage = coverageData || {
    overall_eligible: true,
    eligible_amount: 120000,
    co_pay_amount: 25000,
    excluded_items: ['Cosmetic procedures'],
    rule_results: [
      { rule_name: 'Policy Active Check', passed: true, message: 'Policy is active and within validity' },
      { rule_name: 'Pre-existing Condition', passed: true, message: 'No pre-existing exclusions apply' },
      { rule_name: 'Room Rent Cap', passed: false, message: 'Room charges exceed sub-limit by Rs. 2,000' },
      { rule_name: 'Procedure Coverage', passed: true, message: 'All procedures covered under plan' },
    ],
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg flex items-center justify-center shadow-lg shadow-blue-100">
            <span className="text-white font-bold text-xl">CS</span>
          </div>
          <div>
            <h1 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-blue-500">
              ClaimSense.ai — Patient Portal
            </h1>
            {claimId && (
              <p className="text-xs text-slate-400 font-medium">Claim: {claimId}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <NotificationPanel />
          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-red-500 px-3 py-2 rounded-lg hover:bg-red-50 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 pb-24">
        {/* Status Banner */}
        <div className={`${banner.color} border rounded-2xl p-6 mb-6 flex items-center gap-4 animate-fade-in`}>
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center bg-white/60 shadow-sm`}>
            <BannerIcon className={`w-6 h-6 ${banner.iconColor}`} />
          </div>
          <div>
            <h2 className="text-xl font-black">{banner.label}</h2>
            <p className="text-sm opacity-80 mt-0.5">{formatStatus(status)} — Your claim is being processed</p>
          </div>
        </div>

        <div className="flex gap-6">
          {/* ── LEFT COLUMN (60%) ────────────────────────────────── */}
          <div className="w-[60%] flex flex-col gap-6">
            {/* Missing Documents Alert */}
            {status === 'DOCUMENTS_MISSING' && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-3 animate-fade-in">
                <FileWarning className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="font-bold text-red-800">Missing Documents</h4>
                  <p className="text-sm text-red-700 mt-1">
                    Please upload the following: <span className="font-semibold">Discharge Summary, Final Bill</span>
                  </p>
                </div>
              </div>
            )}

            {/* Document Upload */}
            <DocumentUpload
              claimId={claimId}
              onUploadComplete={() => {
                // Refresh timeline
                if (claimId) {
                  getTimeline(claimId).then((d) => setTimeline(d.timeline || [])).catch(() => {});
                }
              }}
            />
          </div>

          {/* ── RIGHT COLUMN (40%) ───────────────────────────────── */}
          <div className="w-[40%] flex flex-col gap-6">
            {/* Coverage Display */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-blue-500" />
                  Coverage Summary
                </h3>
              </div>
              <div className="p-6 space-y-4">
                {/* Amount Cards */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-green-50 rounded-xl p-4 border border-green-100">
                    <p className="text-xs text-green-600 font-semibold mb-1">Eligible Amount</p>
                    <p className="text-xl font-black text-green-700">₹{coverage.eligible_amount?.toLocaleString()}</p>
                  </div>
                  <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                    <p className="text-xs text-amber-600 font-semibold mb-1">Your Co-Pay</p>
                    <p className="text-xl font-black text-amber-700">₹{coverage.co_pay_amount?.toLocaleString()}</p>
                  </div>
                </div>

                {/* Rules */}
                <div className="space-y-2.5 mt-2">
                  {coverage.rule_results?.map((rule, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                      {rule.passed ? (
                        <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 text-green-600 text-xs font-bold flex-shrink-0">✓</span>
                      ) : (
                        <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 text-red-600 text-xs font-bold flex-shrink-0">✗</span>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-700">{rule.rule_name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{rule.message}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Excluded Items */}
                {coverage.excluded_items?.length > 0 && (
                  <div className="mt-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <p className="text-xs font-semibold text-slate-500 mb-1">Not Covered</p>
                    <p className="text-sm text-slate-700">{coverage.excluded_items.join(', ')}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Timeline */}
            <StatusTimeline events={timeline} />
          </div>
        </div>
      </main>

      {/* Chat Assistant FAB */}
      <ChatAssistant claimId={claimId} />
    </div>
  );
}
