import client from './client';

// The notification list is polled every 15s. We cache the last ETag + payload
// and revalidate with If-None-Match; when the server answers 304 Not Modified
// we hand back the cached list, so an unchanged poll costs an empty response
// instead of the full list every time.
let lastEtag: string | null = null;
let lastData: unknown[] = [];

export const getNotifications = async () => {
  const response = await client.get('/api/notifications', {
    headers: lastEtag ? { 'If-None-Match': lastEtag } : undefined,
    // Treat 304 as success so the cached list can be returned.
    validateStatus: (s) => s === 304 || (s >= 200 && s < 300),
  });
  if (response.status === 304) {
    return lastData;
  }
  lastEtag = (response.headers?.etag as string) ?? null;
  lastData = response.data;
  return response.data;
};

export const markAsRead = async (id: number) => {
  const response = await client.put(`/api/notifications/${id}/read`);
  return response.data;
};

export const markAllAsRead = async () => {
  const response = await client.put('/api/notifications/read-all');
  return response.data;
};
