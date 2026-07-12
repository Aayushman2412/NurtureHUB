/**
 * useTestEventEmitter — Custom hook for emitting real-time test events via WebSocket.
 *
 * Opens a WebSocket to /ws/candidate/{attempt_id} and provides an emitEvent function
 * that sends structured events to the backend for live monitoring.
 *
 * Features:
 * - Auto-reconnect with exponential backoff
 * - Heartbeat every 30 seconds
 * - Browser event detection (tab switch, fullscreen exit, blur/focus, copy/paste)
 * - Offline event queueing with flush on reconnect
 * - Monotonically increasing sequence numbers for idempotency
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { WS_BASE_URL } from '../api/config';

const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const MAX_RECONNECT_DELAY = 30000; // 30 seconds max backoff
const INITIAL_RECONNECT_DELAY = 1000; // 1 second initial backoff

interface EventPayload {
  question_id?: number;
  question_number?: number;
  selected_option_id?: number;
  time_on_question_ms?: number;
  [key: string]: any;
}

interface TestEvent {
  type: string;
  timestamp: string;
  sequence: number;
  payload: EventPayload;
}

interface UseTestEventEmitterOptions {
  attemptId: number;
  enabled?: boolean;
}

interface UseTestEventEmitterReturn {
  emitEvent: (type: string, payload?: EventPayload) => void;
  isConnected: boolean;
  warningMessage: string | null;
  forceSubmitTriggered: boolean;
  clearWarning: () => void;
}

export function useTestEventEmitter({
  attemptId,
  enabled = true,
}: UseTestEventEmitterOptions): UseTestEventEmitterReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const sequenceRef = useRef(0);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const reconnectTimeoutRef = useRef<any>(null);
  const heartbeatIntervalRef = useRef<any>(null);
  const eventQueueRef = useRef<TestEvent[]>([]);
  const mountedRef = useRef(true);

  const [isConnected, setIsConnected] = useState(false);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [forceSubmitTriggered, setForceSubmitTriggered] = useState(false);

  const getToken = () => localStorage.getItem('nh_token') || '';

  // ── Build and send an event ──
  const buildEvent = useCallback((type: string, payload: EventPayload = {}): TestEvent => {
    sequenceRef.current += 1;
    return {
      type,
      timestamp: new Date().toISOString(),
      sequence: sequenceRef.current,
      payload,
    };
  }, []);

  const sendEvent = useCallback((event: TestEvent) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(event));
    } else {
      // Queue for later
      eventQueueRef.current.push(event);
      // Cap queue size at 500 events
      if (eventQueueRef.current.length > 500) {
        eventQueueRef.current = eventQueueRef.current.slice(-500);
      }
    }
  }, []);

  const flushQueue = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const queue = [...eventQueueRef.current];
      eventQueueRef.current = [];
      for (const event of queue) {
        wsRef.current.send(JSON.stringify(event));
      }
    }
  }, []);

  // ── Public emit function ──
  const emitEvent = useCallback((type: string, payload: EventPayload = {}) => {
    const event = buildEvent(type, payload);
    sendEvent(event);
  }, [buildEvent, sendEvent]);

  const clearWarning = useCallback(() => {
    setWarningMessage(null);
  }, []);

  // ── Connect to WebSocket ──
  const connect = useCallback(() => {
    if (!enabled || !mountedRef.current) return;

    const token = getToken();
    if (!token) return;

    const url = `${WS_BASE_URL}/ws/candidate/${attemptId}?token=${encodeURIComponent(token)}`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setIsConnected(true);
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
        flushQueue();

        // Start heartbeat
        heartbeatIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            const hb = buildEvent('HEARTBEAT');
            ws.send(JSON.stringify(hb));
          }
        }, HEARTBEAT_INTERVAL);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'ADMIN_WARNING') {
            setWarningMessage(data.message || 'Warning from administrator');
          } else if (data.type === 'FORCE_SUBMIT') {
            setForceSubmitTriggered(true);
          }
        } catch {
          // Ignore non-JSON messages
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setIsConnected(false);
        cleanup();
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire after onerror
      };
    } catch {
      scheduleReconnect();
    }
  }, [enabled, attemptId, buildEvent, flushQueue]);

  const cleanup = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current || !enabled) return;

    reconnectTimeoutRef.current = setTimeout(() => {
      connect();
    }, reconnectDelayRef.current);

    // Exponential backoff
    reconnectDelayRef.current = Math.min(
      reconnectDelayRef.current * 2,
      MAX_RECONNECT_DELAY
    );
  }, [connect, enabled]);

  // ── Browser event detection ──
  useEffect(() => {
    if (!enabled) return;

    // Tab visibility change
    const handleVisibilityChange = () => {
      if (document.hidden) {
        emitEvent('TAB_SWITCH');
      } else {
        emitEvent('WINDOW_FOCUS');
      }
    };

    // Fullscreen change
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        emitEvent('FULLSCREEN_EXIT');
      }
    };

    // Window blur/focus
    const handleBlur = () => emitEvent('WINDOW_BLUR');
    const handleFocus = () => emitEvent('WINDOW_FOCUS');

    // Copy/paste detection
    const handleCopy = () => {
      emitEvent('COPY_PASTE_DETECTED', { action: 'copy' });
    };
    const handlePaste = () => {
      emitEvent('COPY_PASTE_DETECTED', { action: 'paste' });
    };

    // Right-click detection (potential screenshot tool invocation)
    const handleContextMenu = () => {
      emitEvent('COPY_PASTE_DETECTED', { action: 'context_menu' });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('copy', handleCopy);
    document.addEventListener('paste', handlePaste);
    document.addEventListener('contextmenu', handleContextMenu);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('copy', handleCopy);
      document.removeEventListener('paste', handlePaste);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [enabled, emitEvent]);

  // ── Connect on mount, disconnect on unmount ──
  useEffect(() => {
    mountedRef.current = true;
    if (enabled) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      cleanup();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [enabled, attemptId]);

  return {
    emitEvent,
    isConnected,
    warningMessage,
    forceSubmitTriggered,
    clearWarning,
  };
}

export default useTestEventEmitter;
