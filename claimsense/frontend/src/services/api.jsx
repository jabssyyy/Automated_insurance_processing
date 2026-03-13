/**
 * ClaimSense — API Service
 *
 * Axios instance with JWT interceptor.
 * Token is read from the AuthContext exported by useAuth.
 */

import axios from 'axios'

// Module-level token holder — updated by AuthProvider
let _token = null

export const setApiToken = (token) => {
  _token = token
}

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
})

// Attach JWT to every request
api.interceptors.request.use((config) => {
  if (_token) {
    config.headers['Authorization'] = `Bearer ${_token}`
  }
  return config
})

// ── Auth ─────────────────────────────────────────────────────────────────────

export const demoLogin = (role) =>
  api.post('/auth/demo-login', { role })

// ── Claims ───────────────────────────────────────────────────────────────────

export const getClaims = () =>
  api.get('/dashboard/claims')

export const createClaim = (policyNumber, claimType = 'inpatient', path = 'cashless') =>
  api.post('/dashboard/create-claim', { policy_number: policyNumber, claim_type: claimType, path })

export const runPipeline = (claimId) =>
  api.post(`/pipeline/process/${claimId}`)

export const continuePipeline = (claimId) =>
  api.post(`/pipeline/continue/${claimId}`)

export const getTimeline = (claimId) =>
  api.get(`/dashboard/timeline/${claimId}`)

// ── Documents (M1) ───────────────────────────────────────────────────────────

export const uploadDocuments = (claimId, files) => {
  const formData = new FormData()
  files.forEach((file) => formData.append('files', file))
  return api.post(`/m1/upload/${claimId}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export const runDocCheck = (claimId) =>
  api.post(`/m1/check/${claimId}`)

// ── M2 Validation ─────────────────────────────────────────────────────────────

export const runValidation = (claimId) =>
  api.post(`/m2/validate/${claimId}`)

// ── Review ───────────────────────────────────────────────────────────────────

export const checkReview = (claimId) =>
  api.get(`/review/status/${claimId}`)

export const fetchReviewQueue = () =>
  api.get('/review/queue')

export const fetchReviewContext = (reviewId) =>
  api.get(`/review/${reviewId}`)

export const approveReview = (reviewId, notes = '') =>
  api.post(`/review/${reviewId}/approve`, { notes })

export const rejectReview = (reviewId, denialReason, notes = '') =>
  api.post(`/review/${reviewId}/reject`, { denial_reason: denialReason, notes })

// ── M3 Submission ─────────────────────────────────────────────────────────────

export const finalizeClaim = (claimId) =>
  api.post(`/m3/finalize/${claimId}`)

export const submitClaim = (claimId) =>
  api.post(`/m3/submit/${claimId}`)

export const mockApprove = (claimId) =>
  api.post(`/m3/mock-approve/${claimId}`)

// ── AI Assistant ──────────────────────────────────────────────────────

export const extractBillData = (file) => {
  const formData = new FormData()
  formData.append('file', file)
  return api.post('/pipeline/extract-bill', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000, // Gemini extraction can take longer
  })
}

export const sendChat = (claimId, message, conversationHistory = []) =>
  api.post('/assistant/chat', {
    claim_id: claimId,
    message,
    conversation_history: (conversationHistory || []).map(m => ({
      role: m.role,
      content: m.content || m.text || '',
    })),
  })

// ── Notifications ─────────────────────────────────────────────────────────────

export const getNotifications = () =>
  api.get('/notifications/')

export const markNotificationRead = (id) =>
  api.patch(`/notifications/${id}/read`)

export default api
