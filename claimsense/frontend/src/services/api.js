/**
<<<<<<< HEAD
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
=======
 * ClaimSense.ai — API Service Layer
 *
 * Centralized API calls for the frontend.
 * All requests proxy through Vite to FastAPI at localhost:8000.
 */

const API_BASE = '/api';

async function request(url, options = {}) {
  const defaultHeaders = {
    'Content-Type': 'application/json',
  };

  const token = localStorage.getItem('cs_token');
  if (token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: { ...defaultHeaders, ...options.headers },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `API Error ${res.status}`);
  }

  return res.json();
}

// ═══════════════════════════════════════════════════════════
// Review endpoints
// ═══════════════════════════════════════════════════════════

export function fetchReviewQueue() {
  return request('/review/queue');
}

export function fetchReviewContext(reviewId) {
  return request(`/review/${reviewId}`);
}

export function checkReview(claimId) {
  return request(`/review/check/${claimId}`, { method: 'POST' });
}

export function approveReview(reviewId, reviewerId, notes) {
  return request(`/review/${reviewId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ reviewer_id: reviewerId, notes }),
  });
}

export function rejectReview(reviewId, reviewerId, notes, denialReason) {
  return request(`/review/${reviewId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reviewer_id: reviewerId, notes, denial_reason: denialReason }),
  });
}

// ═══════════════════════════════════════════════════════════
// M3 endpoints
// ═══════════════════════════════════════════════════════════

export function finalizeClaim(claimId) {
  return request(`/m3/finalize/${claimId}`, { method: 'POST' });
}

export function submitClaim(claimId) {
  return request(`/m3/submit/${claimId}`, { method: 'POST' });
}

export function mockApproveClaim(claimId) {
  return request(`/m3/mock-approve/${claimId}`, { method: 'POST' });
}

// ═══════════════════════════════════════════════════════════
// M2 endpoints
// ═══════════════════════════════════════════════════════════

export function validateClaim(claimId) {
  return request(`/m2/validate/${claimId}`, { method: 'POST' });
}

// ═══════════════════════════════════════════════════════════
// Claim endpoints
// ═══════════════════════════════════════════════════════════

export function fetchClaims() {
  return request('/claims');
}

export function fetchClaim(claimId) {
  return request(`/claims/${claimId}`);
}

// ═══════════════════════════════════════════════════════════
// SSE connection
// ═══════════════════════════════════════════════════════════

export function connectSSE(claimId, onMessage) {
  const url = `${API_BASE}/sse/stream/${claimId}`;
  const source = new EventSource(url);

  source.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch {
      onMessage({ detail: event.data });
    }
  };

  source.onerror = () => {
    console.warn('SSE connection error, reconnecting...');
  };

  return source;
}
>>>>>>> ce3a0935a3f98fdefa84cfecb4e14b1ede5f6c16
