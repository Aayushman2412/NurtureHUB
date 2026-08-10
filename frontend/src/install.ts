/**
 * App installation (PWA "Add to home screen" / "Install app").
 *
 * Chromium browsers — Android Chrome, desktop Chrome/Edge — fire
 * `beforeinstallprompt` when the site qualifies as installable. The event must
 * be captured and kept: it can only be replayed later from a user gesture, and
 * the browser fires it BEFORE React mounts, so we listen at module load.
 *
 * iOS Safari has no programmatic install at all — the only route is the Share
 * sheet, so there we show instructions instead of a button that cannot work.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach(fn => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => {
    // Stop the browser's own mini-infobar; we surface our own button instead.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

/** Subscribe to installability changes (returns an unsubscribe function). */
export function onInstallStateChange(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/** Already running as an installed app? */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

/** Can we trigger the browser's install prompt right now? */
export function canPromptInstall(): boolean {
  return deferredPrompt !== null;
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as a Mac; touch points tell them apart.
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/**
 * Show the browser's install prompt.
 * Returns 'accepted' | 'dismissed', or 'unavailable' when there is no prompt
 * to show (iOS, Firefox, or already installed) so the caller can fall back to
 * instructions.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) return 'unavailable';
  const event = deferredPrompt;
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    // A prompt can only be used once; Chrome re-fires the event if declined.
    deferredPrompt = null;
    notify();
    return outcome;
  } catch {
    return 'unavailable';
  }
}
