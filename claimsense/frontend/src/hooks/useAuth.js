/**
 * useAuth — React context + hook for auth state.
 *
 * Provides: { token, role, userId, isAuthenticated, login, logout }
 * Token lives in React state ONLY — not in localStorage.
 */

import React, { createContext, useContext, useState, useCallback } from 'react'
import { demoLogin, setApiToken } from '../services/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null)
  const [role, setRole]   = useState(null)
  const [userId, setUserId] = useState(null)
  const [email, setEmail]   = useState(null)

  const login = useCallback(async (roleChoice) => {
    const res = await demoLogin(roleChoice)
    const { access_token, role: r, user_id, email: e } = res.data
    setToken(access_token)
    setRole(r)
    setUserId(user_id)
    setEmail(e)
    setApiToken(access_token)
    return { token: access_token, role: r }
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setRole(null)
    setUserId(null)
    setEmail(null)
    setApiToken(null)
  }, [])

  return (
    <AuthContext.Provider value={{
      token,
      role,
      userId,
      email,
      isAuthenticated: !!token,
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
