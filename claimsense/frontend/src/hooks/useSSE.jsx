/**
 * useSSE — Server-Sent Events hook with exponential backoff.
 *
 * Connects to /api/dashboard/stream?token={jwt}.
 * Auto-reconnects with exponential backoff (1s, 2s, 4s, … max 30s).
 *
 * Returns: { events, latestEvent, isConnected, reconnecting }
 */

import { useState, useEffect, useRef, useCallback } from 'react'

const MIN_RETRY_MS = 1000
const MAX_RETRY_MS = 30000

export function useSSE(token) {
  const [events, setEvents]             = useState([])
  const [latestEvent, setLatestEvent]   = useState(null)
  const [isConnected, setIsConnected]   = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const esRef         = useRef(null)
  const retryTimer    = useRef(null)
  const retryDelay    = useRef(MIN_RETRY_MS)
  const mountedRef    = useRef(true)

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
      if (!mountedRef.current) return
      setIsConnected(true)
      setReconnecting(false)
      retryDelay.current = MIN_RETRY_MS  // Reset backoff on success
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
      setReconnecting(true)
      es.close()
      esRef.current = null

      // Exponential backoff: 1s, 2s, 4s, 8s, … max 30s
      const delay = retryDelay.current
      retryTimer.current = setTimeout(() => {
        if (mountedRef.current) connect()
      }, delay)
      retryDelay.current = Math.min(delay * 2, MAX_RETRY_MS)
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

  return { events, latestEvent, isConnected, reconnecting }
}
