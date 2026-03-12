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

// ── Review ──────────────────────────────────────────────────────────

export async function checkReview(claimId) {
  const res = await api.post(`/review/check`, { claim_id: claimId });
  return res.data;
}

export async function getReviewQueue() {
  const res = await api.get('/review/queue');
  return res.data;
}

export async function approveReview(reviewId, notes) {
  const res = await api.post(`/review/approve/${reviewId}`, { notes });
  return res.data;
}

export async function rejectReview(reviewId, notes, reason) {
  const res = await api.post(`/review/reject/${reviewId}`, {
    notes,
    denial_reason: reason,
  });
  return res.data;
}

// ── M3 Finalization ─────────────────────────────────────────────────

export async function finalizeClaim(claimId) {
  const res = await api.post(`/m3/finalize/${claimId}`);
  return res.data;
}

export async function submitClaim(claimId) {
  const res = await api.post(`/m3/submit/${claimId}`);
  return res.data;
}

// ── Mock Approve (demo shortcut) ────────────────────────────────────

export async function mockApprove(claimId) {
  const res = await api.post(`/review/approve/${claimId}`, {
    notes: 'Demo approval',
  });
  return res.data;
}

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

export default api;
