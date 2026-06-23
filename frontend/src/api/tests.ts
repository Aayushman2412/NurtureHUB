import client from './client';

export const getTests = async () => {
  const response = await client.get('/api/tests');
  return response.data;
};

export const getTestDetails = async (id: number) => {
  const response = await client.get(`/api/tests/${id}`);
  return response.data;
};

export const startAttempt = async (id: number) => {
  const response = await client.post(`/api/tests/${id}/start`);
  return response.data;
};

export interface AnswerSubmit {
  question_id: number;
  selected_option_id: number | null;
  is_marked_for_review: boolean;
}

export interface TestSubmitRequest {
  answers: AnswerSubmit[];
  time_used_seconds: number;
}

export const submitAttempt = async (attemptId: number, data: TestSubmitRequest) => {
  const response = await client.post(`/api/tests/attempts/${attemptId}/submit`, data);
  return response.data;
};
