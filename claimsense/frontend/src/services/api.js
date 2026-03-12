/**
 * ClaimSense.ai — API Service Layer.
 *
 * Axios instance with JWT interceptor and all backend API functions.
 * Base URL is "/api" which Vite proxies to localhost:8000.
 */
import axios from 'axios';

// ── Axios instance ──────────────────────────────────────────────────
const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Token holder — set by useAuth via setApiToken()
// Note: Person 2 used localStorage, but F1 spec requires React state only.
// We will follow the F1 spec for high-security demo requirements.
let _token = null;

export function setApiToken(token) {
  _token = token;
}

// JWT interceptor — attach token to every request
api.interceptors.request.use((config) => {
  if (_token) {
    config.headers.Authorization = `Bearer ${_token}`;
  }
  return config;
});

// ── Auth ────────────────────────────────────────────────────────────

export async function demoLogin(role) {
  const emailMap = {
    patient: 'demo_patient@claimsense.ai',
    hospital_staff: 'demo_hospital@claimsense.ai',
    insurer: 'demo_insurer@claimsense.ai',
  };
  const res = await api.post('/auth/login', {
    email: emailMap[role],
    password: 'demo1234',
  });
  return res.data; // { access_token, token_type, role, user_id }
}

// ── Documents (M1) ─────────────────────────────────────────────────

export async function uploadDocuments(claimId, files) {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));
  const res = await api.post(`/m1/upload/${claimId}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

// ── Doc Check ───────────────────────────────────────────────────────

export async function runDocCheck(claimId) {
  const res = await api.post(`/doc-check/check/${claimId}`);
  return res.data;
}

// ── M2 Validation ───────────────────────────────────────────────────

export async function runValidation(claimId) {
  const res = await api.post(`/m2/validate/${claimId}`);
  return res.data;
}

// ── Review (Governance Layer) ───────────────────────────────────────

export async function checkReview(claimId) {
  const res = await api.post(`/review/check/${claimId}`);
  return res.data;
}

export async function fetchReviewQueue() {
  const res = await api.get('/review/queue');
  return res.data;
}

export async function fetchReviewContext(reviewId) {
  const res = await api.get(`/review/${reviewId}`);
  return res.data;
}

export async function approveReview(reviewId, reviewerId, notes) {
  const res = await api.post(`/review/${reviewId}/approve`, {
    reviewer_id: reviewerId,
    notes,
  });
  return res.data;
}

export async function rejectReview(reviewId, reviewerId, notes, denialReason) {
  const res = await api.post(`/review/${reviewId}/reject`, {
    reviewer_id: reviewerId,
    notes,
    denial_reason: denialReason,
  });
  return res.data;
}

// Aliases for compatibility
export const getReviewQueue = fetchReviewQueue;

// ── M3 Finalization ─────────────────────────────────────────────────

export async function finalizeClaim(claimId) {
  const res = await api.post(`/m3/finalize/${claimId}`);
  return res.data;
}

export async function submitClaim(claimId) {
  const res = await api.post(`/m3/submit/${claimId}`);
  return res.data;
}

// shortcut for demo
export async function mockApproveClaim(claimId) {
  const res = await api.post(`/m3/mock-approve/${claimId}`);
  return res.data;
}

export const mockApprove = mockApproveClaim;

// ── Assistant ───────────────────────────────────────────────────────

export async function sendChat(claimId, message, history = []) {
  const res = await api.post('/assistant/chat', {
    claim_id: claimId,
    message,
    conversation_history: history,
  });
  return res.data; // { response, claim_id }
}

// ── Notifications ───────────────────────────────────────────────────

export async function getNotifications() {
  const res = await api.get('/notifications/');
  return res.data; // { notifications, unread_count, total }
}

export async function markNotificationRead(id) {
  const res = await api.post(`/notifications/${id}/read`);
  return res.data;
}

// ── Dashboard ───────────────────────────────────────────────────────

export async function getClaims() {
  const res = await api.get('/dashboard/claims');
  return res.data; // { claims, count }
}

export async function getTimeline(claimId) {
  const res = await api.get(`/dashboard/timeline/${claimId}`);
  return res.data; // { claim_id, timeline }
}

export async function fetchClaim(claimId) {
  const res = await api.get(`/dashboard/claims/${claimId}`);
  return res.data;
}

export default api;
