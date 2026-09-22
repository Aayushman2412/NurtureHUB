/**
 * Results insights — the numbers behind the Results dashboard.
 *
 * Pure functions over the /api/admin/results payload, so the page only draws.
 * Everything is computed in the browser: a cohort is a few thousand rows at
 * most, and it lets the reader re-slice instantly (compare by cadre, block,
 * experience …; click a group to see the whole dashboard for it).
 */

import { TONE_GOOD, TONE_LOW, TONE_OK } from '../utils/brandColors';

/** Traffic-light colour for a 0–100 rate: green 75+, amber 50–74, red below. */
export function toneColor(value: number, good = 75, ok = 50): string {
  return value >= good ? TONE_GOOD : value >= ok ? TONE_OK : TONE_LOW;
}

export const fmtPct = (x: number) => `${Math.round(x)}%`;

// ── Payload types (shared with AdminResultsPage) ────────────────────────────

export interface TutorialMeta {
  id: number;
  title: string;
  module_number: string;
  has_quiz: boolean;
  stage_title?: string;
  stage_order?: number;
}

export interface TestMeta {
  id: number;
  title: string;
  test_type: 'formative' | 'screening' | null;
  status: string;
  passing_score_pct?: number;
  max_attempts?: number;
}

export interface TestResult {
  attempts_count: number;
  best_score: number | null;
  first_score?: number | null;
  passed_first_attempt?: boolean;
  is_passed: boolean;
  max_risk_score: number;
  was_flagged: boolean;
  tab_switches: number;
  fullscreen_exits: number;
  copy_paste_events: number;
}

export interface TutorialProgressRow {
  watch_pct: number;
  is_completed: boolean;
  quiz_status: string;
  quiz_score: number | null;
  quiz_total: number | null;
}

export interface LearnerProfile {
  cadre?: string | null;
  department?: string | null;
  block?: string | null;
  experience?: string | null;
  experience_order?: number | null;
  qualification?: string | null;
  age?: number | null;
  gender?: string | null;
  internet_workplace?: string | null;
  nutrition_training?: string | null;
  years_service?: number | null;
}

export interface UserResultRow {
  user_id: number;
  name: string;
  email: string;
  completed_flow: boolean;
  summary: {
    total_tutorials: number;
    tutorials_completed: number;
    avg_watch_pct: number;
    quizzes_completed: number;
    quizzes_skipped: number;
    quiz_accuracy_pct: number;
    performance_score: number;
  };
  tutorials?: Record<string, TutorialProgressRow>;
  tests: Record<string, TestResult>;
  profile?: LearnerProfile;
  face_to_face: {
    selected: boolean;
    selected_at: string | null;
    uploaded_by: string | null;
  };
}

export interface ResultsData {
  district: string;
  district_name: string;
  tutorials: TutorialMeta[];
  tests: TestMeta[];
  users: UserResultRow[];
}

// ── Dimensions: the ways a manager can split the cohort ─────────────────────

export type DimensionKey =
  | 'cadre' | 'department' | 'block' | 'experience' | 'qualification'
  | 'ageGroup' | 'internet' | 'priorTraining';

export const DIMENSIONS: DimensionKey[] = [
  'cadre', 'department', 'block', 'experience', 'qualification', 'ageGroup', 'internet', 'priorTraining',
];

/** Sentinel for "the learner's profile doesn't say". Rendered via i18n. */
export const NOT_RECORDED = '__not_recorded__';

const AGE_BANDS: [number, number, string][] = [
  [0, 24, 'Under 25'], [25, 34, '25–34'], [35, 44, '35–44'], [45, 200, '45 and above'],
];
const INTERNET_ORDER = ['Always', 'Often', 'Sometimes', 'Rarely', 'Never'];

function tidy(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  return v ? v : null;
}

/** The group a learner falls in for a dimension (null = not recorded). */
export function groupOf(u: UserResultRow, dim: DimensionKey): string | null {
  const p = u.profile ?? {};
  switch (dim) {
    case 'cadre': return tidy(p.cadre);
    // "Women & Child Development Department (WCD)" -> "Women & Child Development (WCD)"
    case 'department': return tidy(p.department)?.replace(/\s+Department\b/i, '') ?? null;
    case 'block': return tidy(p.block);
    case 'experience': return tidy(p.experience);
    case 'qualification': return tidy(p.qualification);
    case 'ageGroup': {
      if (!p.age) return null;
      const band = AGE_BANDS.find(([lo, hi]) => p.age! >= lo && p.age! <= hi);
      return band ? band[2] : null;
    }
    case 'internet': return tidy(p.internet_workplace);
    case 'priorTraining': return tidy(p.nutrition_training);
  }
}

/** Natural order for ordered dimensions; others sort by size (largest first). */
function groupSortKey(dim: DimensionKey, users: UserResultRow[], group: string): number {
  if (dim === 'experience') {
    const u = users.find(x => groupOf(x, dim) === group);
    return u?.profile?.experience_order ?? 99;
  }
  if (dim === 'ageGroup') return AGE_BANDS.findIndex(b => b[2] === group);
  if (dim === 'internet') {
    const i = INTERNET_ORDER.indexOf(group);
    return i < 0 ? 99 : i;
  }
  if (dim === 'priorTraining') return group === 'Yes' ? 0 : 1;
  return -users.filter(x => groupOf(x, dim) === group).length;
}

// ── Tests that actually happened ────────────────────────────────────────────

export interface ActiveTest extends TestMeta {
  /** Short, reader-facing name: "Formative test", "Screening test", or the title. */
  label: string;
  passMark: number;
}

/** Tests at least one learner wrote, in phase order. A test nobody has taken
 *  (a draft, a leftover trial) would only add empty columns and zero rates. */
export function activeTests(data: ResultsData, labelFor: (t: TestMeta) => string): ActiveTest[] {
  const written = data.tests.filter(t => data.users.some(u => (u.tests[String(t.id)]?.attempts_count ?? 0) > 0));
  const labels = written.map(labelFor);
  return written.map((t, i) => ({
    ...t,
    // Two tests of the same kind would share a label; fall back to titles.
    label: labels.filter(l => l === labels[i]).length > 1 ? t.title : labels[i],
    passMark: t.passing_score_pct ?? 70,
  }));
}

// ── Statistics ──────────────────────────────────────────────────────────────

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export const finishedVideos = (u: UserResultRow) =>
  u.summary.total_tutorials > 0 && u.summary.tutorials_completed >= u.summary.total_tutorials;

export interface TestStats {
  wrote: number;
  passed: number;
  passRate: number;          // % of those who wrote
  avgScore: number;          // average best score of those who wrote
  firstTry: number;          // passed on the first attempt
  afterRetake: number;       // passed, but not on the first attempt
  notPassed: number;
  bands: { excellent: number; passed: number; nearMiss: number; support: number };
}

export interface CohortStats {
  n: number;
  finishedVideos: number;
  avgWatch: number;
  quizAccuracy: number;      // average of learners who answered at least one quiz
  performance: number;
  tests: Record<number, TestStats>;
  selected: number;
  passedAll: number;         // passed every active test
  passedNone: number;        // wrote at least one test and passed none
}

export function testStats(users: UserResultRow[], test: ActiveTest): TestStats {
  const rows = users.map(u => u.tests[String(test.id)]).filter(r => r && r.attempts_count > 0);
  const passed = rows.filter(r => r.is_passed).length;
  const firstTry = rows.filter(r => r.is_passed && r.passed_first_attempt).length;
  const excellentFrom = Math.max(85, test.passMark);
  const bands = { excellent: 0, passed: 0, nearMiss: 0, support: 0 };
  for (const r of rows) {
    const s = r.best_score ?? 0;
    if (s >= excellentFrom) bands.excellent += 1;
    else if (s >= test.passMark) bands.passed += 1;
    else if (s >= test.passMark - 20) bands.nearMiss += 1;
    else bands.support += 1;
  }
  return {
    wrote: rows.length,
    passed,
    passRate: pct(passed, rows.length),
    avgScore: avg(rows.map(r => r.best_score ?? 0)),
    firstTry,
    afterRetake: passed - firstTry,
    notPassed: rows.length - passed,
    bands,
  };
}

export function cohortStats(users: UserResultRow[], tests: ActiveTest[]): CohortStats {
  const quizTakers = users.filter(u => u.summary.quizzes_completed > 0);
  const byTest: Record<number, TestStats> = {};
  for (const t of tests) byTest[t.id] = testStats(users, t);
  const wroteAny = (u: UserResultRow) => tests.some(t => (u.tests[String(t.id)]?.attempts_count ?? 0) > 0);
  const passedAny = (u: UserResultRow) => tests.some(t => u.tests[String(t.id)]?.is_passed);
  return {
    n: users.length,
    finishedVideos: users.filter(finishedVideos).length,
    avgWatch: avg(users.map(u => u.summary.avg_watch_pct)),
    quizAccuracy: avg(quizTakers.map(u => u.summary.quiz_accuracy_pct)),
    performance: avg(users.map(u => u.summary.performance_score)),
    tests: byTest,
    selected: users.filter(u => u.face_to_face.selected).length,
    passedAll: tests.length ? users.filter(u => tests.every(t => u.tests[String(t.id)]?.is_passed)).length : 0,
    passedNone: users.filter(u => wroteAny(u) && !passedAny(u)).length,
  };
}

export interface GroupStats extends CohortStats {
  group: string;             // NOT_RECORDED for missing values
}

/** One row per group of a dimension, in a sensible reading order. */
export function groupStats(users: UserResultRow[], dim: DimensionKey, tests: ActiveTest[]): GroupStats[] {
  const buckets = new Map<string, UserResultRow[]>();
  for (const u of users) {
    const g = groupOf(u, dim) ?? NOT_RECORDED;
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g)!.push(u);
  }
  const groups = [...buckets.keys()].sort((a, b) => {
    if (a === NOT_RECORDED) return 1;
    if (b === NOT_RECORDED) return -1;
    return groupSortKey(dim, users, a) - groupSortKey(dim, users, b) || a.localeCompare(b);
  });
  return groups.map(g => ({ group: g, ...cohortStats(buckets.get(g)!, tests) }));
}

/** Dimensions worth offering: at least two recorded groups. */
export function usefulDimensions(users: UserResultRow[]): DimensionKey[] {
  return DIMENSIONS.filter(d => new Set(users.map(u => groupOf(u, d)).filter(Boolean)).size >= 2);
}

// ── The learner journey ─────────────────────────────────────────────────────

export interface JourneyStep {
  key: string;
  params?: Record<string, string>;
  count: number;
}

/**
 * The steps a learner passes through, in order. Earlier tests are learning
 * checks — a learner goes on to the next phase whether or not they passed —
 * so only WRITING them is a step; passing is a step for the final test alone,
 * the one selection follows. (Listing every "passed" would make the bars dip
 * and climb again, which reads as people coming back.)
 */
export function journey(users: UserResultRow[], tests: ActiveTest[]): JourneyStep[] {
  const steps: JourneyStep[] = [
    { key: 'registered', count: users.length },
    { key: 'finishedVideos', count: users.filter(finishedVideos).length },
  ];
  for (const t of tests) {
    steps.push({ key: 'wroteTest', params: { test: t.label }, count: testStats(users, t).wrote });
  }
  const last = tests[tests.length - 1];
  if (last) steps.push({ key: 'passedTest', params: { test: last.label }, count: testStats(users, last).passed });
  steps.push({ key: 'selected', count: users.filter(u => u.face_to_face.selected).length });
  return steps;
}

// ── Videos ──────────────────────────────────────────────────────────────────

export interface VideoStats {
  id: number;
  title: string;
  phase?: string;
  finishedPct: number;
  avgWatch: number;
  hasQuiz: boolean;
  quizCorrectPct: number | null;   // null when nobody answered its quiz
  quizAnswered: number;
}

export function videoStats(data: ResultsData, users: UserResultRow[]): VideoStats[] {
  return data.tutorials.map(t => {
    const rows = users.map(u => u.tutorials?.[String(t.id)]).filter(Boolean) as TutorialProgressRow[];
    const answered = rows.filter(r => r.quiz_status === 'completed' && (r.quiz_total ?? 0) > 0);
    const correct = answered.reduce((a, r) => a + (r.quiz_score ?? 0), 0);
    const total = answered.reduce((a, r) => a + (r.quiz_total ?? 0), 0);
    return {
      id: t.id,
      title: t.title,
      phase: t.stage_title,
      finishedPct: pct(rows.filter(r => r.is_completed).length, users.length),
      avgWatch: avg(users.map(u => u.tutorials?.[String(t.id)]?.watch_pct ?? 0)),
      hasQuiz: t.has_quiz,
      quizCorrectPct: total > 0 ? pct(correct, total) : null,
      quizAnswered: answered.length,
    };
  });
}

// ── Top performers ──────────────────────────────────────────────────────────

/** Average of best scores across the tests a learner wrote (null if none). */
export function overallScore(u: UserResultRow, tests: ActiveTest[]): number | null {
  const scores = tests.map(t => u.tests[String(t.id)]).filter(r => r && r.attempts_count > 0).map(r => r.best_score ?? 0);
  return scores.length ? avg(scores) : null;
}

export function topPerformers(users: UserResultRow[], tests: ActiveTest[], limit = 10): UserResultRow[] {
  return users
    .filter(u => overallScore(u, tests) !== null)
    .sort((a, b) =>
      (overallScore(b, tests)! - overallScore(a, tests)!)
      || (b.summary.performance_score - a.summary.performance_score)
      || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// ── Findings: the handful of sentences a manager should read first ──────────

export interface Finding {
  tone: 'good' | 'watch' | 'info';
  key: string;
  params: Record<string, string | number>;
}

const round = (x: number) => Math.round(x);

export function findings(
  users: UserResultRow[], tests: ActiveTest[], dim: DimensionKey,
  groups: GroupStats[], videos: VideoStats[], groupLabel: (g: string) => string,
): Finding[] {
  const out: Finding[] = [];
  if (users.length === 0 || tests.length === 0) return out;
  const overall = cohortStats(users, tests);
  const last = tests[tests.length - 1];
  const lastStats = overall.tests[last.id];

  // 1. The headline outcome.
  out.push({
    tone: lastStats.passRate >= 60 ? 'good' : 'watch',
    key: 'headline',
    params: { passed: lastStats.passed, wrote: lastStats.wrote, pct: round(lastStats.passRate), test: last.label },
  });

  // 2. Best and weakest group on the final test (groups big enough to mean something).
  const sized = groups.filter(g => g.group !== NOT_RECORDED && g.tests[last.id]?.wrote >= 5);
  if (sized.length >= 2) {
    const byRate = [...sized].sort((a, b) => b.tests[last.id].passRate - a.tests[last.id].passRate);
    const best = byRate[0];
    const worst = byRate[byRate.length - 1];
    if (best.tests[last.id].passRate - worst.tests[last.id].passRate >= 5) {
      out.push({
        tone: 'good', key: 'bestGroup',
        params: {
          group: groupLabel(best.group), pct: round(best.tests[last.id].passRate), test: last.label,
          overall: round(lastStats.passRate), passed: best.tests[last.id].passed, wrote: best.tests[last.id].wrote, dim,
        },
      });
      out.push({
        tone: 'watch', key: 'weakestGroup',
        params: {
          group: groupLabel(worst.group), pct: round(worst.tests[last.id].passRate), test: last.label,
          passed: worst.tests[last.id].passed, wrote: worst.tests[last.id].wrote, dim,
        },
      });
    } else {
      out.push({ tone: 'info', key: 'evenGroups', params: { test: last.label, dim } });
    }
  }

  // 3. Where people fall out of the journey.
  const steps = journey(users, tests);
  let worstDrop = { from: '', to: '', lost: 0, fromParams: {} as Record<string, string>, toParams: {} as Record<string, string> };
  for (let i = 1; i < steps.length; i++) {
    const lost = steps[i - 1].count - steps[i].count;
    if (lost > worstDrop.lost) {
      worstDrop = { from: steps[i - 1].key, to: steps[i].key, lost, fromParams: steps[i - 1].params ?? {}, toParams: steps[i].params ?? {} };
    }
  }
  if (worstDrop.lost > 0) {
    out.push({
      tone: 'watch', key: `drop.${worstDrop.to}`,
      params: { n: worstDrop.lost, test: worstDrop.toParams.test ?? '', pct: round(pct(worstDrop.lost, users.length)) },
    });
  }

  // 4. Retakes: how many needed a second chance.
  const retook = tests.reduce((a, t) => a + overall.tests[t.id].afterRetake, 0);
  if (retook > 0) {
    out.push({ tone: 'info', key: 'retakes', params: { n: retook, firstTry: round(pct(lastStats.firstTry, lastStats.wrote)), test: last.label } });
  }

  // 5. Do the video quizzes predict the test? (Only when both sides are big enough.)
  const strong = users.filter(u => u.summary.quizzes_completed > 0 && u.summary.quiz_accuracy_pct >= 80);
  const rest = users.filter(u => u.summary.quizzes_completed > 0 && u.summary.quiz_accuracy_pct < 80);
  const rate = (xs: UserResultRow[]) => pct(xs.filter(u => u.tests[String(last.id)]?.is_passed).length,
    xs.filter(u => (u.tests[String(last.id)]?.attempts_count ?? 0) > 0).length);
  if (strong.length >= 10 && rest.length >= 10) {
    const a = rate(strong);
    const b = rate(rest);
    // A small gap on a few hundred people is noise; only say it when it is clear.
    if (Math.abs(a - b) >= 10) {
      out.push({ tone: a > b ? 'good' : 'info', key: a > b ? 'quizPredicts' : 'quizNoPredict', params: { a: round(a), b: round(b), test: last.label } });
    }
  }

  // 6. The hardest video quiz — a concern only if it actually went badly.
  const quizzed = videos.filter(v => v.quizCorrectPct !== null && v.quizAnswered >= 5);
  if (quizzed.length >= 2) {
    const hardest = [...quizzed].sort((a, b) => a.quizCorrectPct! - b.quizCorrectPct!)[0];
    const params = { title: hardest.title, pct: round(hardest.quizCorrectPct!) };
    out.push(hardest.quizCorrectPct! < 70
      ? { tone: 'watch', key: 'hardestQuiz', params }
      : { tone: 'good', key: 'quizzesFine', params });
  }

  // 7. Selection.
  if (overall.selected > 0) {
    out.push({ tone: 'good', key: 'selected', params: { n: overall.selected, pct: round(pct(overall.selected, users.length)) } });
  }
  return out;
}
