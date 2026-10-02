import type { ActiveTest, DimensionKey, ResultsData, TestQuestions, UserResultRow } from '../../lib/resultsInsights';

export type DimensionFilters = Partial<Record<DimensionKey, string>>;

/**
 * What the Insights shell hands every page: the tests that were written, the
 * ways to split learners, and the shared filters (groups the reader clicked),
 * which follow them from page to page.
 */
export interface InsightCtx {
  data: ResultsData;
  tests: ActiveTest[];
  dims: DimensionKey[];
  dim: DimensionKey;
  setDim: (d: DimensionKey) => void;
  /** Everyone, or only the focused group(s). */
  users: UserResultRow[];
  /** Who to split by `dim`: the filtered group when it was chosen on another
   *  dimension (a cross-section), otherwise everyone — so the focused group
   *  stays visible, highlighted, among its peers. */
  compareBase: UserResultRow[];
  filters: DimensionFilters;
  activeGroup: string | null;
  toggleFocus: (group: string) => void;
  clearFilter: (dim?: DimensionKey) => void;
  groupLabel: (group: string, dim?: DimensionKey) => string;
  colorOf: (i: number) => string;
  questions: Record<number, TestQuestions>;
  questionsLoaded: boolean;
  openView: (view: string) => void;
}
