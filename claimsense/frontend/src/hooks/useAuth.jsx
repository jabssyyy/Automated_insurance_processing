/**
 * useAuth — React context + hook for auth state.
 *
 * Provides: { token, role, userId, isAuthenticated, login, logout, loading }
 * Token persists in localStorage so auth survives page refresh.
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { demoLogin, setApiToken } from '../services/api.jsx'

const AuthContext = createContext(null)
const STORAGE_KEY = 'claimsense_auth'

export function AuthProvider({ children }) {
  const [loading, setLoading] = useState(true)
  const [token, setToken]   = useState(null)
  const [role, setRole]     = useState(null)
  const [userId, setUserId] = useState(null)
  const [email, setEmail]   = useState(null)

  // Rehydrate auth from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed.token) {
          setToken(parsed.token)
          setRole(parsed.role)
          setUserId(parsed.userId)
          setEmail(parsed.email)
          setApiToken(parsed.token)
        }
      }
    } catch (e) {
      console.warn('Failed to rehydrate auth:', e)
      localStorage.removeItem(STORAGE_KEY)
    } finally {
      setLoading(false)
    }
  }, [])

  const login = useCallback(async (roleChoice) => {
    const res = await demoLogin(roleChoice)
    const { access_token, role: r, user_id, email: e } = res.data
    setToken(access_token)
    setRole(r)
    setUserId(user_id)
    setEmail(e)
    setApiToken(access_token)
    // Persist to localStorage
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      token: access_token, role: r, userId: user_id, email: e,
    }))
    return { token: access_token, role: r }
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setRole(null)
    setUserId(null)
    setEmail(null)
    setApiToken(null)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  return (
    <AuthContext.Provider value={{
      token,
      role,
      userId,
      email,
      isAuthenticated: !!token,
      loading,
      login,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
