import client from './client';

export const getResultsList = async () => {
  const response = await client.get('/api/results');
  return response.data;
};

export const getDetailedResult = async (attemptId: number) => {
  const response = await client.get(`/api/results/${attemptId}`);
  return response.data;
};
