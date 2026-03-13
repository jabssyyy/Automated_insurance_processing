/**
 * ServerStatus — Sticky bottom bar showing backend + Gemini API status.
 *
 * Polls /health and /health/gemini every 15s.
 */

import React, { useState, useEffect, useCallback } from 'react'

export default function ServerStatus() {
  const [server, setServer] = useState({ status: 'checking', detail: 'Connecting…' })
  const [gemini, setGemini] = useState({ status: 'checking', detail: 'Checking…' })

  const checkHealth = useCallback(async () => {
    // Server health
    try {
      const res = await fetch('/api/')
      if (res.ok) {
        const data = await res.json()
        setServer({ status: 'connected', detail: `v${data.version || '0.1.0'}` })
      } else {
        setServer({ status: 'error', detail: `HTTP ${res.status}` })
      }
    } catch {
      setServer({ status: 'offline', detail: 'Server unreachable' })
    }

    // Gemini health
    try {
      const res = await fetch('/api/health/gemini')
      if (res.ok) {
        const data = await res.json()
        if (data.status === 'connected') {
          setGemini({ status: 'connected', detail: data.model || 'Gemini AI' })
        } else {
          setGemini({ status: 'warning', detail: data.reason || 'Not configured' })
        }
      } else {
        setGemini({ status: 'warning', detail: 'Could not check' })
      }
    } catch {
      setGemini({ status: 'offline', detail: 'Not available' })
    }
  }, [])

  useEffect(() => {
    checkHealth()
    const interval = setInterval(checkHealth, 15000)
    return () => clearInterval(interval)
  }, [checkHealth])

  const serverDot = server.status === 'connected' ? 'bg-green-400' : server.status === 'checking' ? 'bg-yellow-400 animate-pulse' : 'bg-red-400'
  const geminiDot = gemini.status === 'connected' ? 'bg-green-400' : gemini.status === 'checking' ? 'bg-yellow-400 animate-pulse' : gemini.status === 'warning' ? 'bg-yellow-400' : 'bg-red-400'

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 h-7 bg-slate-900/95 backdrop-blur border-t border-slate-800 flex items-center justify-center gap-6 text-[10px] font-medium">
      {/* Server Status */}
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${serverDot}`} />
        <span className={server.status === 'connected' ? 'text-green-400' : 'text-red-400'}>
          {server.status === 'connected' ? 'Connected to server' : server.detail}
        </span>
        {server.status === 'connected' && (
          <span className="text-slate-500">{server.detail}</span>
        )}
      </div>

      <span className="text-slate-700">·</span>

      {/* Gemini Status */}
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${geminiDot}`} />
        <span className={gemini.status === 'connected' ? 'text-green-400' : gemini.status === 'warning' ? 'text-yellow-400' : 'text-red-400'}>
          {gemini.status === 'connected' ? 'Gemini API active' : gemini.status === 'warning' ? 'Gemini: ' + gemini.detail : 'Gemini offline'}
        </span>
        {gemini.status === 'connected' && (
          <span className="text-slate-500">{gemini.detail}</span>
        )}
      </div>
    </div>
  )
}
