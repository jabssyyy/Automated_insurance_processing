/**
 * useSSE — Server-Sent Events hook.
 *
 * Connects to /api/dashboard/stream?token={jwt}.
 * Auto-reconnects on disconnect after 3 seconds.
 *
 * Returns: { events, latestEvent, isConnected }
 */

import { useState, useEffect, useRef, useCallback } from 'react'

export function useSSE(token) {
  const [events, setEvents]           = useState([])
  const [latestEvent, setLatestEvent] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const esRef       = useRef(null)
  const retryTimer  = useRef(null)
  const mountedRef  = useRef(true)

  const connect = useCallback(() => {
    if (!token || !mountedRef.current) return

    // Close existing connection
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }

    const url = `/api/dashboard/stream?token=${encodeURIComponent(token)}`
    const es = new EventSource(url)
    esRef.current = es

    es.onopen = () => {
      if (mountedRef.current) setIsConnected(true)
    }

    es.onmessage = (e) => {
      if (!mountedRef.current) return
      try {
        const parsed = JSON.parse(e.data)
        setLatestEvent(parsed)
        setEvents((prev) => [...prev.slice(-99), parsed]) // keep last 100
      } catch {
        // Ignore heartbeat or non-JSON frames
      }
    }

    es.onerror = () => {
      if (!mountedRef.current) return
      setIsConnected(false)
      es.close()
      esRef.current = null
      // Auto-reconnect after 3 seconds
      retryTimer.current = setTimeout(() => {
        if (mountedRef.current) connect()
      }, 3000)
    }
  }, [token])

  useEffect(() => {
    mountedRef.current = true
    if (token) connect()

    return () => {
      mountedRef.current = false
      if (retryTimer.current) clearTimeout(retryTimer.current)
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
    }
  }, [token, connect])

  return { events, latestEvent, isConnected }
}
