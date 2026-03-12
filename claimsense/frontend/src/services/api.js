/**
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
