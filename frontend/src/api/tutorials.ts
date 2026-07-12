import client from './client';

export const getStages = async () => {
  const response = await client.get('/api/stages');
  return response.data;
};

export const completeTutorial = async (id: number) => {
  const response = await client.post(`/api/tutorials/${id}/complete`);
  return response.data;
};

// ── Watch tracking ──────────────────────────────────────────

export interface ProgressBeat {
  position_seconds: number;
  watched_delta_seconds: number;
  duration_seconds?: number | null;
}

export interface ProgressState {
  tutorial_id: number;
  watch_time_seconds: number;
  watch_pct: number;
  is_completed: boolean;
  quiz_available: boolean;
  quiz_status: 'pending' | 'completed' | 'skipped';
}

export const updateTutorialProgress = async (
  id: number,
  beat: ProgressBeat
): Promise<ProgressState> => {
  const response = await client.post(`/api/tutorials/${id}/progress`, beat);
  return response.data;
};

// ── Post-tutorial quiz ──────────────────────────────────────

export interface QuizOption {
  id: number;
  label: string;
  text: string;
}

export interface QuizQuestion {
  id: number;
  text: string;
  order_index: number;
  options: QuizOption[];
}

export interface TutorialQuiz {
  tutorial_id: number;
  quiz_available: boolean;
  questions: QuizQuestion[];
}

export interface QuizResult {
  tutorial_id: number;
  correct_count: number;
  total_questions: number;
  score_pct: number;
}

export const getTutorialQuiz = async (id: number): Promise<TutorialQuiz> => {
  const response = await client.get(`/api/tutorials/${id}/quiz`);
  return response.data;
};

export const submitTutorialQuiz = async (
  id: number,
  answers: { question_id: number; selected_option_id: number | null }[]
): Promise<QuizResult> => {
  const response = await client.post(`/api/tutorials/${id}/quiz/submit`, { answers });
  return response.data;
};

export const skipTutorialQuiz = async (id: number) => {
  const response = await client.post(`/api/tutorials/${id}/quiz/skip`);
  return response.data;
};
