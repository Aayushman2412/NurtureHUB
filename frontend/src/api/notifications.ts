import client from './client';

export const getNotifications = async () => {
  const response = await client.get('/api/notifications');
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
