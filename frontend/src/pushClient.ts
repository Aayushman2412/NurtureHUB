/**
 * Push-subscription lifecycle for the learner app.
 *
 * Policy (per product decision): phones — and the installed PWA on any device —
 * get system push notifications for every notification the backend creates;
 * plain desktop-browser sessions keep the in-app notifications tab only, so
 * laptop users are never nagged for notification permission.
 */
import { getPushPublicKey, registerPushSubscription } from './api/push';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Phone-ish contexts: coarse pointer / installed app — where push belongs. */
export function isMobileOrInstalled(): boolean {
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  const mobile = window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 1024;
  return standalone || mobile;
}

const DISMISS_KEY = 'nh_push_prompt_dismissed';

export function shouldOfferPush(): boolean {
  return (
    pushSupported() &&
    isMobileOrInstalled() &&
    Notification.permission === 'default' &&
    localStorage.getItem(DISMISS_KEY) !== 'true'
  );
}

export function dismissPushPrompt(): void {
  localStorage.setItem(DISMISS_KEY, 'true');
}

/**
 * Request permission (must be called from a user gesture) and register the
 * subscription with the backend. Returns true when notifications are active.
 */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false;
  const { public_key, enabled } = await getPushPublicKey();
  if (!enabled || !public_key) return false;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key) as BufferSource,
    }));

  const json = subscription.toJSON();
  await registerPushSubscription({
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
    user_agent: navigator.userAgent.slice(0, 300),
  });
  return true;
}

/** Silently re-register an existing subscription (e.g. after login). */
export async function resyncPushSubscription(): Promise<void> {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    const json = subscription.toJSON();
    await registerPushSubscription({
      endpoint: subscription.endpoint,
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
      user_agent: navigator.userAgent.slice(0, 300),
    });
  } catch {
    // best-effort
  }
}

/** Best-effort detach of this device from the account (called on logout).
 *  Takes a token snapshot because logout clears localStorage before this
 *  async work reaches the network. */
export async function detachPushSubscription(token: string | null): Promise<void> {
  try {
    if (!pushSupported() || !token) return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    const { API_BASE_URL } = await import('./api/config');
    await fetch(`${API_BASE_URL}/api/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
      keepalive: true,
    });
  } catch {
    // best-effort
  }
}
