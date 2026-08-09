/**
 * Service-worker registration + PWA runtime glue.
 *
 * registerType is 'autoUpdate' and the SW calls skipWaiting(), so new builds
 * activate on the next navigation without prompting — field devices always
 * run the latest version. We additionally poll for a new SW once an hour for
 * long-lived installed sessions.
 */
import { registerSW } from 'virtual:pwa-register'

const UPDATE_CHECK_MS = 60 * 60 * 1000

export function setupPWA(): void {
  // Ask the browser not to evict our storage (offline queue, cached shell)
  // under pressure. Best-effort — iOS Safari in-browser still purges after
  // 7 idle days unless the app is installed to the home screen.
  try {
    void navigator.storage?.persist?.().catch(() => {})
  } catch {
    // Older browsers without the Storage API.
  }

  if (!('serviceWorker' in navigator)) return

  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return
      setInterval(() => {
        registration.update().catch(() => {})
      }, UPDATE_CHECK_MS)
    },
  })
  void updateSW

  // Deep-links coming from a tapped push notification: the SW focuses an
  // existing window and asks it to route (a full reload would lose app state).
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'PUSH_NAVIGATE' && typeof event.data.link === 'string') {
      window.history.pushState(null, '', event.data.link)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
  })
}

/**
 * Wipe cached API/media data so it cannot leak to the next user on a shared
 * device. Runs on logout, on 401 session expiry and on identity-change login.
 *
 * Deletes the caches directly from the window (Cache Storage is page-visible)
 * — a SW postMessage alone silently no-ops in uncontrolled windows (e.g.
 * after a hard reload). The SW message stays as belt-and-braces.
 */
export async function clearOfflineCaches(): Promise<void> {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_API_CACHE' })
  } catch {
    // No SW — nothing to message.
  }
  try {
    if ('caches' in window) {
      await Promise.all([caches.delete('nh-api'), caches.delete('nh-media')])
    }
  } catch {
    // Cache API unavailable (very old browser / opaque context) — best effort.
  }
}
