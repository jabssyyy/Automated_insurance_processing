/**
 * ClaimSense.ai — Auth Context + Hook.
 *
 * Provides authentication state across the app.
 * Token lives in React state ONLY (no localStorage).
 */
import React, { createContext, useContext, useState, useCallback } from 'react';
import { demoLogin as apiDemoLogin, setApiToken } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [role, setRole] = useState(null);
  const [userId, setUserId] = useState(null);

  const login = useCallback(async (selectedRole) => {
    const data = await apiDemoLogin(selectedRole);
    setToken(data.access_token);
    setRole(data.role);
    setUserId(data.user_id);
    setApiToken(data.access_token);
    return data;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setRole(null);
    setUserId(null);
    setApiToken(null);
  }, []);

  const value = {
    token,
    role,
    userId,
    isAuthenticated: !!token,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
