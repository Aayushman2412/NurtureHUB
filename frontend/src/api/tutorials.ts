import client from './client';

export const getStages = async () => {
  const response = await client.get('/api/stages');
  return response.data;
};

export const completeTutorial = async (id: number) => {
  const response = await client.post(`/api/tutorials/${id}/complete`);
  return response.data;
};
