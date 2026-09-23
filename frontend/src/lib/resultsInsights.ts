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

// ── One test on its own ─────────────────────────────────────────────────────

export interface QuestionStat {
  id: number;
  number: number;
  text: string;
  correct_label: string | null;
  correct_text: string | null;
  writers: number;
  correct: number;
  unanswered: number;
  top_wrong_label: string | null;
  top_wrong_text: string | null;
  top_wrong_count: number;
}

export interface TestQuestions {
  test_id: number;
  writers: number;
  questions: QuestionStat[];
}

export interface ScoreBar {
  label: string;          // "60%" or "60–69"
  lo: number;             // lowest score the bar holds
  hi: number;             // highest score the bar holds
  count: number;
}

/**
 * How the best scores are spread. A short paper can only produce a few
 * scores (5 questions: 0, 20, 40 … 100%), and 10-point bands would leave every
 * other bar empty — which reads as missing data. So: one bar per possible
 * score when there are few, 10-point bands when there are many.
 */
export function scoreDistribution(users: UserResultRow[], test: ActiveTest, questionCount?: number): ScoreBar[] {
  const scores = users
    .map(u => u.tests[String(test.id)])
    .filter(r => r && r.attempts_count > 0)
    .map(r => Math.round((r.best_score ?? 0) * 10) / 10);
  const distinct = new Set(scores);
  if (questionCount && questionCount <= 12) {
    for (let k = 0; k <= questionCount; k++) distinct.add(Math.round((k * 1000) / questionCount) / 10);
  }
  if (distinct.size <= 13) {
    return [...distinct].sort((a, b) => a - b).map(v => ({
      label: `${Math.round(v)}%`, lo: v, hi: v, count: scores.filter(s => s === v).length,
    }));
  }
  const bars: ScoreBar[] = Array.from({ length: 10 }, (_, i) => ({
    label: i === 9 ? '90+' : `${i * 10}–${i * 10 + 9}`, lo: i * 10, hi: i === 9 ? 100 : i * 10 + 9.99, count: 0,
  }));
  for (const s of scores) bars[Math.min(9, Math.floor(s / 10))].count += 1;
  return bars;
}

export interface TestGroupRow {
  group: string;
  n: number;              // learners in the group
  stats: TestStats;
}

export function testGroupStats(users: UserResultRow[], dim: DimensionKey, test: ActiveTest): TestGroupRow[] {
  return groupStats(users, dim, [test]).map(g => ({ group: g.group, n: g.n, stats: g.tests[test.id] }));
}

const wroteIt = (u: UserResultRow, test: ActiveTest) => (u.tests[String(test.id)]?.attempts_count ?? 0) > 0;
const bestOf = (u: UserResultRow, test: ActiveTest) => u.tests[String(test.id)]?.best_score ?? 0;

/** Learners who wrote the test and did not pass, lowest score first. */
export function lowestScorers(users: UserResultRow[], test: ActiveTest, limit = 10): UserResultRow[] {
  return users
    .filter(u => wroteIt(u, test) && !u.tests[String(test.id)].is_passed)
    .sort((a, b) => bestOf(a, test) - bestOf(b, test) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Highest score first; fewer attempts breaks a tie. */
export function topScorers(users: UserResultRow[], test: ActiveTest, limit = 10): UserResultRow[] {
  return users
    .filter(u => wroteIt(u, test))
    .sort((a, b) => bestOf(b, test) - bestOf(a, test)
      || a.tests[String(test.id)].attempts_count - b.tests[String(test.id)].attempts_count
      || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function shorten(text: string, max = 70): string {
  const s = (text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function testFindings(
  users: UserResultRow[], test: ActiveTest, dim: DimensionKey, groupLabel: (g: string) => string,
  questions?: TestQuestions,
): Finding[] {
  const out: Finding[] = [];
  const s = testStats(users, test);
  if (s.wrote === 0) return out;
  out.push({
    tone: s.passRate >= 60 ? 'good' : 'watch', key: 'test.headline',
    params: { passed: s.passed, wrote: s.wrote, pct: round(s.passRate), test: test.label, avg: round(s.avgScore) },
  });
  const groups = testGroupStats(users, dim, test).filter(g => g.group !== NOT_RECORDED && g.stats.wrote >= 5);
  if (groups.length >= 2) {
    const byRate = [...groups].sort((a, b) => b.stats.passRate - a.stats.passRate);
    const best = byRate[0];
    const worst = byRate[byRate.length - 1];
    if (best.stats.passRate - worst.stats.passRate >= 5) {
      out.push({ tone: 'good', key: 'bestGroup', params: {
        group: groupLabel(best.group), pct: round(best.stats.passRate), test: test.label, overall: round(s.passRate),
        passed: best.stats.passed, wrote: best.stats.wrote, dim } });
      out.push({ tone: 'watch', key: 'weakestGroup', params: {
        group: groupLabel(worst.group), pct: round(worst.stats.passRate), test: test.label,
        passed: worst.stats.passed, wrote: worst.stats.wrote, dim } });
    } else {
      out.push({ tone: 'info', key: 'evenGroups', params: { test: test.label, dim } });
    }
  }
  if (s.passed > 0) {
    out.push({ tone: 'info', key: 'test.attempts', params: {
      firstTry: s.firstTry, afterRetake: s.afterRetake, notPassed: s.notPassed, test: test.label } });
  }
  if (s.bands.nearMiss > 0) {
    out.push({ tone: 'watch', key: 'test.nearMiss', params: { n: s.bands.nearMiss, mark: test.passMark } });
  }
  const notWritten = users.length - s.wrote;
  if (notWritten > 0) {
    out.push({ tone: 'watch', key: 'test.notWritten', params: { n: notWritten, test: test.label } });
  }
  const qs = (questions?.questions ?? []).filter(q => q.writers > 0);
  if (qs.length >= 2) {
    const share = (q: QuestionStat) => q.correct / q.writers;
    const hardest = [...qs].sort((a, b) => share(a) - share(b))[0];
    const easiest = [...qs].sort((a, b) => share(b) - share(a))[0];
    out.push({ tone: share(hardest) < 0.6 ? 'watch' : 'info', key: 'test.hardestQuestion', params: {
      n: hardest.number, text: shorten(hardest.text), pct: round(pct(hardest.correct, hardest.writers)),
      wrong: hardest.top_wrong_label ?? '—' } });
    out.push({ tone: 'good', key: 'test.easiestQuestion', params: {
      n: easiest.number, text: shorten(easiest.text), pct: round(pct(easiest.correct, easiest.writers)) } });
  }
  return out;
}

// ── Two tests compared ──────────────────────────────────────────────────────

/** A change smaller than this many points counts as "about the same". */
export const SAME_BAND = 5;
/** Score bands for the side-by-side grid. */
export const GRID_BANDS: [number, number][] = [[0, 39], [40, 59], [60, 74], [75, 89], [90, 100]];

export interface PairStats {
  n: number;                    // wrote both
  avgA: number;
  avgB: number;
  change: number;               // avgB - avgA, in points
  improved: number;
  same: number;
  dropped: number;
  passBoth: number;
  passAOnly: number;
  passBOnly: number;
  passNeither: number;
  passRateA: number;
  passRateB: number;
  correlation: number | null;   // Pearson r of the paired scores (null if too few)
  grid: number[][];             // [band of B][band of A] counts, GRID_BANDS order
}

function bandIndex(score: number): number {
  const i = GRID_BANDS.findIndex(([lo, hi]) => score >= lo && score <= hi);
  return i < 0 ? GRID_BANDS.length - 1 : i;
}

/** Learners who wrote both tests, compared on their best score in each. */
export function pairStats(users: UserResultRow[], a: ActiveTest, b: ActiveTest): PairStats {
  const pairs = users
    .map(u => ({ ra: u.tests[String(a.id)], rb: u.tests[String(b.id)] }))
    .filter(({ ra, rb }) => ra && rb && ra.attempts_count > 0 && rb.attempts_count > 0);
  const xs = pairs.map(p => p.ra.best_score ?? 0);
  const ys = pairs.map(p => p.rb.best_score ?? 0);
  const grid = GRID_BANDS.map(() => GRID_BANDS.map(() => 0));
  let improved = 0, same = 0, dropped = 0, passBoth = 0, passAOnly = 0, passBOnly = 0, passNeither = 0;
  pairs.forEach((p, i) => {
    const d = ys[i] - xs[i];
    if (d >= SAME_BAND) improved += 1; else if (d <= -SAME_BAND) dropped += 1; else same += 1;
    const pa = p.ra.is_passed, pb = p.rb.is_passed;
    if (pa && pb) passBoth += 1; else if (pa) passAOnly += 1; else if (pb) passBOnly += 1; else passNeither += 1;
    grid[bandIndex(ys[i])][bandIndex(xs[i])] += 1;
  });
  const avgA = avg(xs), avgB = avg(ys);
  let correlation: number | null = null;
  if (pairs.length >= 10) {
    const sx = Math.sqrt(xs.reduce((acc, x) => acc + (x - avgA) ** 2, 0));
    const sy = Math.sqrt(ys.reduce((acc, y) => acc + (y - avgB) ** 2, 0));
    const cov = xs.reduce((acc, x, i) => acc + (x - avgA) * (ys[i] - avgB), 0);
    correlation = sx > 0 && sy > 0 ? cov / (sx * sy) : null;
  }
  return {
    n: pairs.length, avgA, avgB, change: avgB - avgA, improved, same, dropped,
    passBoth, passAOnly, passBOnly, passNeither,
    passRateA: pct(passBoth + passAOnly, pairs.length), passRateB: pct(passBoth + passBOnly, pairs.length),
    correlation, grid,
  };
}

export interface PairGroupRow extends PairStats {
  group: string;
  members: number;
}

export function pairGroupStats(users: UserResultRow[], dim: DimensionKey, a: ActiveTest, b: ActiveTest): PairGroupRow[] {
  // Same grouping and reading order as everywhere else, then paired per group.
  const order = groupStats(users, dim, [a]).map(g => g.group);
  return order.map(group => {
    const members = users.filter(u => (groupOf(u, dim) ?? NOT_RECORDED) === group);
    return { group, members: members.length, ...pairStats(members, a, b) };
  });
}

export const signed = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x))}`;

export function compareFindings(
  users: UserResultRow[], a: ActiveTest, b: ActiveTest, dim: DimensionKey, groupLabel: (g: string) => string,
): Finding[] {
  const out: Finding[] = [];
  const s = pairStats(users, a, b);
  if (s.n === 0) return out;
  out.push({
    tone: s.change >= 0 ? 'good' : 'info', key: s.change >= 0 ? 'cmp.up' : 'cmp.down',
    params: { n: s.n, a: a.label, b: b.label, avgA: round(s.avgA), avgB: round(s.avgB), change: round(Math.abs(s.change)) },
  });
  if (s.correlation !== null) {
    const r = s.correlation;
    out.push({
      tone: r >= 0.3 ? 'good' : 'info',
      key: r >= 0.6 ? 'cmp.strongLink' : r >= 0.3 ? 'cmp.someLink' : 'cmp.weakLink',
      params: { a: a.label, b: b.label },
    });
  }
  const rows = pairGroupStats(users, dim, a, b).filter(g => g.group !== NOT_RECORDED && g.n >= 5);
  if (rows.length >= 2) {
    const byChange = [...rows].sort((x, y) => y.change - x.change);
    const best = byChange[0];
    const worst = byChange[byChange.length - 1];
    if (best.change - worst.change >= 3) {
      out.push({ tone: 'good', key: 'cmp.bestGroup', params: {
        group: groupLabel(best.group), change: signed(best.change), avgA: round(best.avgA), avgB: round(best.avgB),
        a: a.label, b: b.label, dim } });
      out.push({ tone: 'watch', key: 'cmp.worstGroup', params: {
        group: groupLabel(worst.group), change: signed(worst.change), avgA: round(worst.avgA), avgB: round(worst.avgB),
        a: a.label, b: b.label, dim } });
    }
  }
  if (s.passAOnly > 0) {
    out.push({ tone: 'watch', key: 'cmp.passedAOnly', params: { n: s.passAOnly, a: a.label, b: b.label } });
  }
  if (s.passBOnly > 0) {
    out.push({ tone: 'good', key: 'cmp.passedBOnly', params: { n: s.passBOnly, a: a.label, b: b.label } });
  }
  return out;
}
