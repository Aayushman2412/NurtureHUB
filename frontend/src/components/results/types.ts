import type { ActiveTest, DimensionKey, ResultsData, TestQuestions, UserResultRow } from '../../lib/resultsInsights';

/** The groups kept, per dimension: "HFW" in department AND "Ambad" or "Partur" in block. */
export type DimensionFilters = Partial<Record<DimensionKey, string[]>>;

/**
 * What the Insights shell hands every page: the tests that were written, the
 * ways to split learners, and the shared filters (groups the reader picked,
 * several per dimension), which follow them from page to page.
 */
export interface InsightCtx {
  data: ResultsData;
  tests: ActiveTest[];
  dims: DimensionKey[];
  dim: DimensionKey;
  setDim: (d: DimensionKey) => void;
  /** Everyone, or only the filtered groups. */
  users: UserResultRow[];
  /** Who to split by `dim`: everyone the OTHER filters keep — so the picked
   *  groups of `dim` stay visible, highlighted, among their peers. */
  compareBase: UserResultRow[];
  filters: DimensionFilters;
  /** The one picked group of `dim` (charts highlight it), else null. */
  activeGroup: string | null;
  /** Every picked group of `dim`. */
  activeGroups: string[];
  toggleFocus: (group: string) => void;
  clearFilter: (dim?: DimensionKey) => void;
  groupLabel: (group: string, dim?: DimensionKey) => string;
  colorOf: (i: number) => string;
  questions: Record<number, TestQuestions>;
  questionsLoaded: boolean;
  openView: (view: string) => void;
}
