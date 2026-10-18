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

/** One topic of a test the learner took: right answers out of its questions.
 *  `topic` null = questions not given a topic yet. */
export interface TopicScore {
  topic: string | null;
  correct: number;
  total: number;
  pct: number | null;
}

/** A test the learner has submitted, topic by topic, from the latest attempt
 *  (review of 18 Oct 2026) — backend app/learner_tests.py. */
export interface TestTopicReport {
  test_id: number;
  title: string;
  test_type: 'formative' | 'screening' | null;
  status: string;
  stage_id: number;
  attempt_id: number;
  attempt_number: number;
  score: number | null;
  is_passed: boolean;
  passing_score_pct: number;
  correct: number;
  total: number;
  topics: TopicScore[];
  strong: string[];
  weak: string[];
  videos: { topic: string; videos: { id: number; title: string; module_number: string | null }[] }[];
}

export const getTopicReport = async (): Promise<TestTopicReport[]> => {
  const response = await client.get('/api/results/topics');
  return response.data.tests;
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
