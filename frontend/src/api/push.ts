import client from './client';

/** Web-push subscription API (learner token). */

export const getPushPublicKey = (): Promise<{ public_key: string; enabled: boolean }> =>
  client.get('/api/push/public-key').then(r => r.data);

export const registerPushSubscription = (payload: {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string;
}): Promise<void> => client.post('/api/push/subscribe', payload).then(() => undefined);

export const unregisterPushSubscription = (endpoint: string): Promise<void> =>
  client.post('/api/push/unsubscribe', { endpoint }).then(() => undefined);
