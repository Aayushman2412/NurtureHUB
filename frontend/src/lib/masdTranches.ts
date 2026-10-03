/**
 * Tranches of adoption, worked out in the browser — the same rule as the
 * backend's app/masd/rules.py `tranches()`, so Programme settings can show each
 * tranche's follow-up and expected activities live, while the analyst types.
 * The dashboard itself always shows the server's figures.
 *
 * Each target step is a tranche: on its date learners were asked for the
 * adoptions it ADDS. Its follow-up runs from that date plus a buffer (a week
 * for the first tranche, four days for later ones) to the report date,
 * rounded down to a multiple of 15 days; its expected forms are the adoptions
 * it added × the expected-forms table at that follow-up.
 */
import type { ActivityKey, ExpectedFormsTable, Targets, TargetStep } from '../api/masd';

export const FU_STEP_DAYS = 15;
export const FU_MAX_DAYS = 270;
export const TARGET_KEYS = ['anc', 'pnc_lt5', 'pnc_ge5', 'nurse'] as const;

export const defaultBuffer = (index: number) => (index === 0 ? 7 : 4);
export const roundFollowUp = (days: number) =>
  Math.max(0, Math.min(FU_MAX_DAYS, Math.floor(days / FU_STEP_DAYS) * FU_STEP_DAYS));

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Cumulative forms one adoption of `row` should have generated after `fu` days. */
export function expectedAt(table: ExpectedFormsTable | undefined, row: keyof ExpectedFormsTable['rows'], fu: number | null)
  : Partial<Record<ActivityKey, number>> {
  const forms = table?.rows?.[row] ?? {};
  const out: Partial<Record<ActivityKey, number>> = {};
  const idx = fu ? table!.durations.reduce((best, d, i) => (d <= fu ? i : best), -1) : -1;
  for (const [k, values] of Object.entries(forms) as [ActivityKey, number[]][]) out[k] = idx >= 0 ? values[idx] ?? 0 : 0;
  return out;
}

export type Forms = Record<ActivityKey, number> & { total: number };
const emptyForms = (): Forms => ({ anc: 0, protein: 0, gm: 0, bf: 0, cf: 0, total: 0 });

export interface TrancheCalc {
  step: number;
  from: string;
  buffer: number;
  clockFrom: string;
  fuRaw: number | null;      // null: opens after the report date
  fu: number | null;
  added: Targets;
  community: Forms;          // one learner of the rest (ANC + PNC<5M + PNC≥5M)
  nurse: Forms;              // one Staff Nurse (PNC<5M hospital adoptions)
}

/** Steps carry CUMULATIVE targets (what the backend stores); `added` is the
 *  difference from the step before. */
export function calcTranches(steps: TargetStep[], table: ExpectedFormsTable | undefined, asOf: string): TrancheCalc[] {
  const sorted = steps.filter(s => s.from).sort((a, b) => (a.from! < b.from! ? -1 : 1));
  const out: TrancheCalc[] = [];
  let prev: Targets = { anc: 0, pnc_lt5: 0, pnc_ge5: 0, nurse: 0 };
  let lastClock: string | null = null;
  sorted.forEach((s, i) => {
    const buffer = s.buffer ?? defaultBuffer(i);
    let clock = addDays(s.from!, buffer);
    if (lastClock && clock < lastClock) clock = lastClock;
    const open = s.from! <= asOf;
    const raw = open ? Math.max(0, daysBetween(clock, asOf)) : null;
    const fu = raw == null ? null : roundFollowUp(raw);
    const added: Targets = {
      anc: Math.max(0, s.anc - prev.anc), pnc_lt5: Math.max(0, s.pnc_lt5 - prev.pnc_lt5),
      pnc_ge5: Math.max(0, s.pnc_ge5 - prev.pnc_ge5), nurse: Math.max(0, s.nurse - prev.nurse),
    };
    const community = emptyForms();
    const nurse = emptyForms();
    if (fu) {
      for (const [type, n] of [['anc', added.anc], ['pnc_lt5', added.pnc_lt5], ['pnc_ge5', added.pnc_ge5]] as const) {
        for (const [k, v] of Object.entries(expectedAt(table, type, fu)) as [ActivityKey, number][]) community[k] += n * v;
      }
      for (const [k, v] of Object.entries(expectedAt(table, 'nurse_lt5', fu)) as [ActivityKey, number][]) nurse[k] += added.nurse * v;
    }
    community.total = community.anc + community.protein + community.gm + community.bf + community.cf;
    nurse.total = nurse.gm + nurse.bf;
    out.push({ step: i + 1, from: s.from!, buffer, clockFrom: clock, fuRaw: raw, fu, added, community, nurse });
    prev = { anc: s.anc, pnc_lt5: s.pnc_lt5, pnc_ge5: s.pnc_ge5, nurse: s.nurse };
    lastClock = clock;
  });
  return out;
}

export function sumForms(parts: Forms[]): Forms {
  const s = emptyForms();
  for (const p of parts) for (const k of Object.keys(s) as (keyof Forms)[]) s[k] += p[k];
  return s;
}
