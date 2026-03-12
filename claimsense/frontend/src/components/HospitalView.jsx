import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { useSSE } from '../hooks/useSSE.jsx';
import { getClaims, getTimeline } from '../services/api.jsx';
import { LogOut, Users, FileCheck, ShieldCheck, Building2 } from 'lucide-react';
import StatusTimeline from './StatusTimeline';
import NotificationPanel from './NotificationPanel';
import ChatAssistant from './ChatAssistant';

// ── Status chip colors ──────────────────────────────────────────────
const STATUS_CHIP = {
  DOCUMENTS_MISSING:  'bg-red-100 text-red-700',
  DOCUMENTS_COMPLETE: 'bg-green-100 text-green-700',
  POLICY_VALIDATING:  'bg-blue-100 text-blue-700',
  APPROVED:           'bg-emerald-100 text-emerald-700',
  DENIED:             'bg-rose-100 text-rose-700',
  UNDER_HUMAN_REVIEW: 'bg-amber-100 text-amber-700',
  SUBMITTED:          'bg-indigo-100 text-indigo-700',
  ASSEMBLING_PACKAGE: 'bg-cyan-100 text-cyan-700',
};

function formatStatus(s) {
  return (s || '').replace(/_/g, ' ');
}

export default function HospitalView() {
  const { logout } = useAuth();
  const { latestEvent } = useSSE();

  const [claims, setClaims] = useState([]);
  const [selectedClaim, setSelectedClaim] = useState(null);
  const [timeline, setTimeline] = useState([]);

  // Demo document data per claim
  const demoDocMap = {
    'CS-2026-001': [
      { name: 'Aadhaar Card',           status: 'present', date: '2026-03-10' },
      { name: 'Insurance Card',         status: 'present', date: '2026-03-10' },
      { name: 'Discharge Summary',      status: 'missing',  date: '-' },
      { name: 'Final Bill',             status: 'missing',  date: '-' },
    ],
    'CS-2026-002': [
      { name: 'Aadhaar Card',           status: 'present', date: '2026-03-11' },
      { name: 'Insurance Card',         status: 'present', date: '2026-03-11' },
      { name: 'Investigation Reports',  status: 'present', date: '2026-03-11' },
    ],
  };

  // Fetch claims
  useEffect(() => {
    (async () => {
      try {
        const data = await getClaims();
        const claimList = (data.claims || []).map((c) => ({
          ...c,
          docs: demoDocMap[c.claim_id] || [],
        }));
        setClaims(claimList);
        if (claimList.length > 0) setSelectedClaim(claimList[0]);
      } catch {
        const fallback = [
          { claim_id: 'CS-2026-001', patient_name: 'Aditya Kumar', current_status: 'POLICY_VALIDATING', total_amount: 145000, created_at: '2026-03-10', docs: demoDocMap['CS-2026-001'] },
          { claim_id: 'CS-2026-002', patient_name: 'Priya Sharma', current_status: 'DOCUMENTS_COMPLETE', total_amount: 85000, created_at: '2026-03-11', docs: demoDocMap['CS-2026-002'] },
        ];
        setClaims(fallback);
        setSelectedClaim(fallback[0]);
      }
    })();
  }, []);

  // Fetch timeline
  useEffect(() => {
    if (!selectedClaim) return;
    (async () => {
      try {
        const data = await getTimeline(selectedClaim.claim_id);
        setTimeline(data.timeline || []);
      } catch {
        setTimeline([
          { status: 'POLICY_VALIDATING', detail: 'Checking policy coverage and medical codes', timestamp: new Date().toISOString() },
          { status: 'DOCUMENTS_COMPLETE', detail: 'All required documents received', timestamp: new Date(Date.now() - 3600000).toISOString() },
          { status: 'DOCUMENTS_MISSING', detail: 'Claim initiated — waiting for documents', timestamp: new Date(Date.now() - 7200000).toISOString() },
        ]);
      }
    })();
  }, [selectedClaim]);

  // SSE live updates
  useEffect(() => {
    if (!latestEvent || !selectedClaim) return;
    if (latestEvent.claim_id === selectedClaim.claim_id) {
      setTimeline((prev) => [
        { status: latestEvent.status, detail: latestEvent.detail, timestamp: latestEvent.timestamp },
        ...prev,
      ]);
      setSelectedClaim((c) => c ? { ...c, current_status: latestEvent.status } : c);
      setClaims((prev) =>
        prev.map((c) =>
          c.claim_id === latestEvent.claim_id ? { ...c, current_status: latestEvent.status } : c
        )
      );
    }
  }, [latestEvent]);

  const missingDocs = selectedClaim?.docs?.filter((d) => d.status === 'missing').map((d) => d.name) || [];

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-teal-600 to-teal-700 rounded-lg flex items-center justify-center shadow-lg shadow-teal-100">
            <span className="text-white font-bold text-xl">CS</span>
          </div>
          <h1 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-700 to-teal-500">
            ClaimSense.ai — Hospital Portal
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <NotificationPanel />
          <div className="flex items-center gap-2 pl-3 border-l border-slate-200">
            <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-semibold text-sm">
              K
            </div>
            <span className="text-sm font-medium text-slate-600">KMCH Kovai</span>
          </div>
          <button onClick={logout} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-red-500 px-3 py-2 rounded-lg hover:bg-red-50 transition-colors">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex h-[calc(100vh-65px)]">
        {/* Sidebar */}
        <aside className="w-[30%] border-r border-slate-200 bg-white overflow-y-auto">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Active Admissions</h2>
          </div>
          <div className="divide-y divide-slate-50">
            {claims.map((claim) => (
              <div
                key={claim.claim_id}
                onClick={() => setSelectedClaim(claim)}
                className={`p-4 cursor-pointer transition-colors hover:bg-teal-50/30 ${
                  selectedClaim?.claim_id === claim.claim_id ? 'bg-teal-50 border-l-4 border-teal-600' : ''
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-bold text-slate-800 text-sm">{claim.patient_name}</h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${STATUS_CHIP[claim.current_status] || 'bg-gray-100 text-gray-700'}`}>
                    {formatStatus(claim.current_status)}
                  </span>
                </div>
                <div className="text-xs text-slate-500 flex justify-between mt-1">
                  <span>{claim.claim_id}</span>
                  <span>₹{claim.total_amount?.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-y-auto p-6 pb-24">
          {selectedClaim ? (
            <div className="max-w-5xl mx-auto animate-fade-in">
              {/* Overview Card */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6 flex justify-between items-center hover:shadow-md transition-shadow">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-teal-50 rounded-xl flex items-center justify-center">
                    <Building2 className="w-7 h-7 text-teal-500" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-800">{selectedClaim.patient_name}</h2>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {selectedClaim.claim_id} · Admitted {selectedClaim.created_at?.split('T')[0]}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500 font-medium mb-1">Estimated Amount</p>
                  <p className="text-2xl font-black text-teal-700">₹{selectedClaim.total_amount?.toLocaleString()}</p>
                </div>
              </div>

              <div className="flex gap-6">
                {/* Left: Documents */}
                <div className="w-1/2 flex flex-col gap-6">
                  {missingDocs.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 text-amber-800">
                      <span className="text-lg mt-0.5">⚠️</span>
                      <p className="text-sm font-medium">
                        Waiting for patient to upload: <span className="font-bold">{missingDocs.join(', ')}</span>
                      </p>
                    </div>
                  )}

                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                      <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        <FileCheck className="w-5 h-5 text-teal-500" />
                        Document Checklist
                      </h3>
                      <span className="text-xs font-medium text-slate-400">
                        {selectedClaim.docs?.filter((d) => d.status === 'present').length || 0}/{selectedClaim.docs?.length || 0} received
                      </span>
                    </div>
                    <table className="w-full text-sm text-left">
                      <thead>
                        <tr className="bg-slate-50/50 text-xs font-semibold text-slate-500 uppercase">
                          <th className="px-6 py-3 border-b border-slate-100">Document Name</th>
                          <th className="px-6 py-3 border-b border-slate-100 text-center">Status</th>
                          <th className="px-6 py-3 border-b border-slate-100">Extracted</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {(selectedClaim.docs || []).map((doc, i) => (
                          <tr key={i} className="hover:bg-slate-50/30 transition-colors">
                            <td className="px-6 py-3.5 font-medium text-slate-700">{doc.name}</td>
                            <td className="px-6 py-3.5 text-center">
                              {doc.status === 'present' ? (
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-600 text-xs font-bold">✓</span>
                              ) : (
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100 text-red-600 text-xs font-bold">✗</span>
                              )}
                            </td>
                            <td className="px-6 py-3.5 text-slate-500">{doc.date}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Right: Pre-auth + Timeline */}
                <div className="w-1/2 flex flex-col gap-6">
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-teal-600" />
                      Pre-authorization Status
                    </h3>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-sm text-slate-500">PA Number</span>
                        <span className="font-mono font-bold text-sm text-slate-800">PA-9920-X12</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-sm text-slate-500">Insurer Response</span>
                        <span className="text-sm text-teal-600 font-bold">Approved (Auto)</span>
                      </div>
                    </div>
                  </div>

                  <StatusTimeline events={timeline} />
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-400">
              <Users className="w-16 h-16 opacity-30 mb-4" />
              <p className="text-lg font-medium">Select a patient to view claim details</p>
            </div>
          )}
        </main>
      </div>

      <ChatAssistant claimId={selectedClaim?.claim_id} />
    </div>
  );
}
