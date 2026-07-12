/**
 * useAdminMonitorSocket — Custom hook for admin live monitoring via WebSocket.
 *
 * Connects to /ws/admin/monitor/{test_id} and manages the full state of all
 * candidates being monitored. Receives initial snapshot and incremental updates.
 *
 * Features:
 * - Initial snapshot loading
 * - Incremental state merging (CANDIDATE_UPDATE, CANDIDATE_CONNECTED, CANDIDATE_DISCONNECTED)
 * - Admin action sending (flag, warn, force-submit)
 * - Connection status tracking
 * - Auto-reconnect
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { WS_BASE_URL } from '../api/config';

const RECONNECT_DELAY = 3000;

export interface CandidateState {
  session_id: number;
  attempt_id: number;
  user_id: number;
  test_id: number;
  user_name: string;
  user_email: string;
  avatar_initials: string;
  status: string;
  current_question: number;
  total_questions: number;
  questions_attempted: number;
  questions_unanswered: number;
  questions_viewed: number;
  questions_skipped: number;
  correct_answers: number;
  wrong_answers: number;
  accuracy_pct: number;
  time_spent_seconds: number;
  remaining_seconds: number;
  avg_time_per_question_ms: number;
  fastest_question_ms: number | null;
  slowest_question_ms: number | null;
  tab_switch_count: number;
  fullscreen_exit_count: number;
  copy_paste_count: number;
  idle_periods: number;
  risk_score: number;
  is_flagged: boolean;
  flag_reason: string | null;
  connected_at: string | null;
  last_heartbeat: string | null;
  test_started_at: string | null;
  // Detail fields (optional, only in detail view)
  events?: any[];
  suspicious_flags?: any[];
  admin_actions?: any[];
  answer_state?: Record<string, any>;
  navigation_pattern?: number[];
}

export interface MonitorStats {
  total_candidates: number;
  active: number;
  idle: number;
  disconnected: number;
  submitted: number;
  not_started: number;
  flagged: number;
  high_risk: number;
  medium_risk: number;
  avg_progress: number;
  avg_accuracy: number;
}

export interface TestInfo {
  test_id: number;
  test_title: string;
  total_questions: number;
  duration_minutes: number;
  admin_count: number;
}

interface AdminActionPayload {
  action: string;
  session_id: number;
  notes?: string;
  message?: string;
}

interface UseAdminMonitorSocketReturn {
  candidates: Map<number, CandidateState>;
  candidateList: CandidateState[];
  testInfo: TestInfo | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  sendAction: (action: AdminActionPayload) => void;
  lastActionResult: any;
}

export function useAdminMonitorSocket(testId: number): UseAdminMonitorSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const candidatesRef = useRef<Map<number, CandidateState>>(new Map());
  const mountedRef = useRef(true);
  const reconnectRef = useRef<any>(null);
  const hasLoadedRef = useRef(false);

  const [candidates, setCandidates] = useState<Map<number, CandidateState>>(new Map());
  const [testInfo, setTestInfo] = useState<TestInfo | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastActionResult, setLastActionResult] = useState<any>(null);

  // Derive a list from the map for rendering
  const candidateList = Array.from(candidates.values());

  const getAdminToken = () => localStorage.getItem('nh_admin_token') || '';

  // ── Update candidates state immutably ──
  const updateCandidates = useCallback((updater: (map: Map<number, CandidateState>) => Map<number, CandidateState>) => {
    candidatesRef.current = updater(candidatesRef.current);
    setCandidates(new Map(candidatesRef.current));
  }, []);

  // ── Send admin action ──
  const sendAction = useCallback((action: AdminActionPayload) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(action));
    }
  }, []);

  // ── Connect to WebSocket ──
  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const token = getAdminToken();
    if (!token) {
      // No admin token — don't hang on the loading spinner.
      setIsLoading(false);
      setError('Admin session expired — please log in again.');
      return;
    }

    const url = `${WS_BASE_URL}/ws/admin/monitor/${testId}?token=${encodeURIComponent(token)}`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setIsConnected(true);
        setError(null);
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;

        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case 'SNAPSHOT': {
              const { candidates: snapCandidates, ...info } = msg.data;
              setTestInfo(info);

              const newMap = new Map<number, CandidateState>();
              for (const c of snapCandidates) {
                newMap.set(c.session_id, c);
              }
              candidatesRef.current = newMap;
              setCandidates(new Map(newMap));
              setIsLoading(false);
              setError(null);
              hasLoadedRef.current = true;
              break;
            }

            case 'CANDIDATE_UPDATE':
            case 'CANDIDATE_CONNECTED': {
              const candidate = msg.data as CandidateState;
              updateCandidates(map => {
                map.set(candidate.session_id, candidate);
                return map;
              });
              break;
            }

            case 'CANDIDATE_DISCONNECTED': {
              const candidate = msg.data as CandidateState;
              updateCandidates(map => {
                map.set(candidate.session_id, { ...candidate, status: 'disconnected' });
                return map;
              });
              break;
            }

            case 'SUSPICIOUS_ALERT': {
              // Could trigger a notification, for now update the candidate
              break;
            }

            case 'ADMIN_ACTION_SYNC': {
              // Another admin performed an action, state is already updated via CANDIDATE_UPDATE
              break;
            }

            case 'ACTION_CONFIRMED': {
              setLastActionResult(msg.data);
              break;
            }

            case 'ERROR': {
              console.error('[Admin WS] Error:', msg.message);
              break;
            }
          }
        } catch (e) {
          console.error('[Admin WS] Parse error:', e);
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setIsConnected(false);
        // If we never received an initial snapshot, don't leave the page stuck
        // on the loading spinner — surface a (transient) connection error.
        if (!hasLoadedRef.current) {
          setIsLoading(false);
          setError('Unable to reach the live feed. Retrying…');
        }
        // Auto-reconnect
        reconnectRef.current = setTimeout(() => {
          connect();
        }, RECONNECT_DELAY);
      };

      ws.onerror = () => {
        // onclose will handle reconnection
      };
    } catch {
      reconnectRef.current = setTimeout(() => {
        connect();
      }, RECONNECT_DELAY);
    }
  }, [testId, updateCandidates]);

  // ── Lifecycle ──
  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [testId]);

  return {
    candidates,
    candidateList,
    testInfo,
    isConnected,
    isLoading,
    error,
    sendAction,
    lastActionResult,
  };
}

export default useAdminMonitorSocket;
