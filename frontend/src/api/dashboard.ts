import client from './client';

export const getDashboardData = async () => {
  const response = await client.get('/api/dashboard');
  return response.data;
};
