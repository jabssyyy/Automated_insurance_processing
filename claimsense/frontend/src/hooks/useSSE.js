/**
 * ClaimSense.ai — SSE Hook.
 *
 * Connects to the dashboard SSE stream and provides real-time events.
 * Auto-reconnects on disconnect with a 3-second delay.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './useAuth';

export default function useSSE() {
  const { token, isAuthenticated } = useAuth();
  const [events, setEvents] = useState([]);
  const [latestEvent, setLatestEvent] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef(null);
  const reconnectTimerRef = useRef(null);

  const connect = useCallback(() => {
    if (!isAuthenticated || !token) return;

    // Close any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const url = `/api/dashboard/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
      console.log('[SSE] Connected');
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setLatestEvent(data);
        setEvents((prev) => [...prev, data]);
      } catch (err) {
        // Heartbeat comments ": heartbeat\n\n" are not JSON — ignore
      }
    };

    es.onerror = () => {
      setIsConnected(false);
      es.close();
      console.log('[SSE] Disconnected — reconnecting in 3s');
      reconnectTimerRef.current = setTimeout(connect, 3000);
    };
  }, [token, isAuthenticated]);

  useEffect(() => {
    connect();
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [connect]);

  return { events, latestEvent, isConnected };
}
