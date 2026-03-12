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

export const getReviewQueue = () =>
  api.get('/review/queue')

export const approveReview = (reviewId, notes) =>
  api.post(`/review/${reviewId}/approve`, { notes })

export const rejectReview = (reviewId, notes, reason) =>
  api.post(`/review/${reviewId}/reject`, { notes, reason })

// ── M3 Submission ─────────────────────────────────────────────────────────────

export const finalizeClaim = (claimId) =>
  api.post(`/m3/finalize/${claimId}`)

export const submitClaim = (claimId) =>
  api.post(`/m3/submit/${claimId}`)

export const mockApprove = (claimId) =>
  api.post(`/m3/mock-approve/${claimId}`)

// ── AI Assistant ──────────────────────────────────────────────────────────────

export const sendChat = (claimId, message, history) =>
  api.post('/assistant/chat', { claim_id: claimId, message, history })

// ── Notifications ─────────────────────────────────────────────────────────────

export const getNotifications = () =>
  api.get('/notifications/')

export const markNotificationRead = (id) =>
  api.patch(`/notifications/${id}/read`)

export default api
