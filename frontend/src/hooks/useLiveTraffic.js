import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

// Phase 3.11 (Dashboard V2) — shared live-traffic socket wiring, extracted from
// the copy-pasted io()/join-project/dashboard-update blocks in Dashboard and
// LiveTraffic. The handshake is authenticated via the httpOnly cookie
// (withCredentials); the server authorizes which project rooms the socket joins.
//
// Returns { logs, connected, socket }:
//  - logs: rolling buffer of `dashboard-update` events (newest first, capped).
//  - connected: socket connection state.
//  - socket: the raw instance (for callers that also emit).
// Switching projectId auto-rejoins the new room and clears the buffer.
export function useLiveTraffic(projectId, { limit = 100, onEvent } = {}) {
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  // Keep onEvent in a ref so a changing callback identity doesn't re-subscribe.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const s = io(API_BASE_URL, {
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });
    socketRef.current = s;

    s.on('connect', () => setConnected(true));
    s.on('connect_error', (e) => { setConnected(false); console.error('socket', e?.message); });
    s.on('disconnect', () => setConnected(false));
    s.on('join-error', (info) => console.warn('Socket join refused:', info));
    s.on('dashboard-update', (data) => {
      setLogs((prev) => [data, ...prev].slice(0, limit));
      onEventRef.current?.(data); // per-event hook for live counters/charts
    });

    return () => { s.disconnect(); socketRef.current = null; };
  }, [limit]);

  // (Re)join the project room whenever the connection or selected project changes;
  // clear the buffer so a project switch doesn't show the prior project's events.
  useEffect(() => {
    setLogs([]);
    const s = socketRef.current;
    if (s && connected && projectId) s.emit('join-project', projectId);
  }, [connected, projectId]);

  return { logs, connected, socket: socketRef.current };
}
