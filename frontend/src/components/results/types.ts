import type { ActiveTest, DimensionKey, ResultsData, TestQuestions, UserResultRow } from '../../lib/resultsInsights';

/**
 * What the Insights shell hands every page: the tests that were written, the
 * ways to split learners, and the shared "focus" (a group the reader clicked),
 * which follows them from page to page.
 */
export interface InsightCtx {
  data: ResultsData;
  tests: ActiveTest[];
  dims: DimensionKey[];
  dim: DimensionKey;
  setDim: (d: DimensionKey) => void;
  /** Everyone, or only the focused group. */
  users: UserResultRow[];
  /** Who to split by `dim`: the focused group when it was chosen on another
   *  dimension (a cross-section), otherwise everyone — so the focused group
   *  stays visible, highlighted, among its peers. */
  compareBase: UserResultRow[];
  activeGroup: string | null;
  toggleFocus: (group: string) => void;
  groupLabel: (group: string, dim?: DimensionKey) => string;
  colorOf: (i: number) => string;
  questions: Record<number, TestQuestions>;
  questionsLoaded: boolean;
  openView: (view: string) => void;
}
