import client from './client';
import { triggerBlobDownload } from './pipelines';

export const getResultsList = async () => {
  const response = await client.get('/api/results');
  return response.data;
};

export const getDetailedResult = async (attemptId: number) => {
  const response = await client.get(`/api/results/${attemptId}`);
  return response.data;
};

/**
 * The raw test data of a project as Excel (admin): learners × questions with
 * the answer each picked on their first attempt, the same grid scored 1/0, and
 * a question reference sheet. `testId` narrows it to one test.
 */
export const downloadTestAnswers = async (project: string, testId?: number): Promise<void> => {
  const res = await client.get('/api/admin/results/answers.xlsx', {
    params: { district: project, ...(testId ? { test_id: testId } : {}) },
    responseType: 'blob',
  });
  const disposition = String(res.headers?.['content-disposition'] || '');
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  triggerBlobDownload(res.data as Blob, match ? decodeURIComponent(match[1]) : `test_answers_${project}.xlsx`);
};
