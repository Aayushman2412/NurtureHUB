/**
 * Central API / WebSocket base-URL configuration.
 *
 * Resolved from Vite env vars so the app works across environments (local dev,
 * LAN, HTTPS deployments) without code changes:
 *   - VITE_API_URL  → REST base   (default: http://localhost:8000)
 *   - VITE_WS_URL   → WebSocket base (default: derived from API_BASE_URL,
 *                     http→ws / https→wss so HTTPS pages don't hit mixed-content)
 *
 * See frontend/.env.example. With no env set, the localhost defaults keep the
 * existing dev/demo flow working unchanged.
 */

export const API_BASE_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000';

/**
 * WebSocket base. If the REST base is a full URL, reuse its host (http→ws).
 * If the REST base is relative/empty (same-origin behind a reverse proxy),
 * derive it from the current page origin — a WebSocket URL must be absolute.
 */
function deriveWsBase(): string {
  if (API_BASE_URL) return API_BASE_URL.replace(/^http(s?):/i, 'ws$1:');
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}`;
  }
  return '';
}

export const WS_BASE_URL: string =
  (import.meta.env.VITE_WS_URL as string | undefined) || deriveWsBase();
