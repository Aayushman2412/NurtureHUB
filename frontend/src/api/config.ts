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

export const WS_BASE_URL: string =
  (import.meta.env.VITE_WS_URL as string | undefined) ??
  API_BASE_URL.replace(/^http(s?):/i, 'ws$1:');
