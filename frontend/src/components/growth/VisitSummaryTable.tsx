import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';
import type { GrowthVisitDetail } from '../../api/growth';
import type { FormResponseDetail } from '../../lib/flowTypes';
import {
  deltaCellFill,
  deltaCellInk,
  lapCellFill,
  zCellFill,
  zCellInk,
} from '../../lib/growthDisplay';
import { formatAge } from '../../lib/growthChart';

/**
 * Per-visit summary: measurements beside their z-scores, the change since the
 * previous measured visit, and the two feeding/health answers that explain
 * that change — so the effect of a health worker's intervention is readable
 * straight off the row.
 */

/** form_key → the short code shown in the Forms column. */
const FORM_CODES: Record<string, string> = {
  growth_monitoring: 'CG',
  breastfeeding: 'BF',
  complementary_feeding: 'CF',
  mother_protein_intake: 'PI',
  antenatal: 'ANC',
};

/**
 * Check Growth field ids read for the feeding columns. The instrument asks
 * them as a chain: was the child breastfed → was anything else given → what.
 */
const BREASTFED_FIELD = 'breastfed_24h';
const OTHER_FOODS_FIELD = 'received_other_foods';
const FOODS_GIVEN_FIELD = 'foods_given';
const OTHER_FOOD_TEXT_FIELD = 'other_food';

const fmtZ = (z: number | null) => (z == null ? '—' : `${z > 0 ? '+' : ''}${z.toFixed(1)}`);
const fmtDelta = (d: number | null) => (d == null ? '—' : `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d).toFixed(1)}`);
const fmtNum = (n: number | null, digits: number, unit: string) =>
  n == null ? '—' : `${n.toFixed(digits)}${unit}`;

/** Forms whose green/red tallies are genuine LAP verdicts. */
const LAP_FORM_KEYS = new Set(['breastfeeding', 'complementary_feeding']);

/**
 * The Check Growth responses of a visit, NEWEST first — same-date
 * resubmissions must resolve highest-id-wins, matching how the backend picks
 * the visit's weight/length and how the LAP matrix picks its cells.
 */
const cgResponses = (responses: FormResponseDetail[]) =>
  responses.filter(r => r.form_key === 'growth_monitoring').slice().sort((a, b) => b.id - a.id);

/** All selected option labels for `fieldId` (multi-select safe). */
const answerLabels = (responses: FormResponseDetail[], fieldId: string): string[] => {
  for (const response of cgResponses(responses)) {
    for (const answer of response.answers_json ?? []) {
      if (answer.nodeId !== fieldId) continue;
      const labels = (answer.selected ?? []).map(s => s.label).filter(Boolean);
      if (labels.length) return labels;
      if (answer.value) return [answer.value];
    }
  }
  return [];
};

/** First answer to `fieldId` (single-select / text fields). */
const answerLabel = (responses: FormResponseDetail[], fieldId: string): string | null =>
  answerLabels(responses, fieldId)[0] ?? null;

/** 'yes' | 'no' | null from a free-form answer label. */
const yesNo = (label: string | null): 'yes' | 'no' | null => {
  if (!label) return null;
  const v = label.trim().toLowerCase();
  if (v.startsWith('yes')) return 'yes';
  if (v.startsWith('no') && !v.startsWith('not applicable')) return 'no';
  return null;
};

type MetricKey = 'wfaz' | 'hfaz' | 'wfhz';

interface Row {
  visit: GrowthVisitDetail;
  green: number;
  red: number;
  codes: string[];
  deltas: Record<MetricKey, number | null>;
  /** Was the child breastfed in the past 24 h? */
  breastfed: 'yes' | 'no' | null;
  breastfedLabel: string | null;
  /** What else was given: [] = nothing, null = the question was not answered. */
  otherFoods: string[] | null;
}

const METRICS: MetricKey[] = ['wfaz', 'hfaz', 'wfhz'];

/** Change vs the most recent EARLIER visit that carried a value for that metric. */
const buildRows = (visits: GrowthVisitDetail[]): Row[] => {
  const previous: Record<MetricKey, number | null> = { wfaz: null, hfaz: null, wfhz: null };
  return visits.map(visit => {
    const deltas = {} as Record<MetricKey, number | null>;
    for (const metric of METRICS) {
      const current = visit.z[metric];
      const prior = previous[metric];
      deltas[metric] = current != null && prior != null ? current - prior : null;
      if (current != null) previous[metric] = current;
    }
    const breastfedLabel = answerLabel(visit.responses, BREASTFED_FIELD);

    // "What else was given" reads the chain: an explicit No means nothing else;
    // a Yes lists the selected foods (plus any free-text "other" specify).
    const gaveOther = yesNo(answerLabel(visit.responses, OTHER_FOODS_FIELD));
    const foods = answerLabels(visit.responses, FOODS_GIVEN_FIELD);
    const otherText = answerLabel(visit.responses, OTHER_FOOD_TEXT_FIELD);
    const extras = otherText ? [...foods.filter(f => !/other/i.test(f)), otherText] : foods;
    const otherFoods = extras.length > 0 ? extras : gaveOther === 'no' ? [] : gaveOther === 'yes' ? [] : null;

    // Only LAP-scored forms contribute — a flat form's "red" is a soft numeric
    // range flag, not an as-per-LAP verdict, and folding it in would mislead.
    const lapResponses = visit.responses.filter(r => LAP_FORM_KEYS.has(r.form_key));
    return {
      visit,
      green: lapResponses.reduce((sum, r) => sum + (r.summary_json?.green ?? 0), 0),
      red: lapResponses.reduce((sum, r) => sum + (r.summary_json?.red ?? 0), 0),
      codes: visit.responses.map(r => FORM_CODES[r.form_key] ?? r.form_key.slice(0, 3).toUpperCase()),
      deltas,
      breastfed: yesNo(breastfedLabel),
      breastfedLabel,
      otherFoods,
    };
  });
};

/** Verdict ink that stays legible on a tinted cell in BOTH themes: a dark
 *  brand shade on the light tint, a light one on the dark-composited tint. */
export const GREEN_INK = 'text-sage-800 dark:text-sage-300';
export const RED_INK = 'text-coral-800 dark:text-coral-300';

const TH_BASE =
  'whitespace-nowrap border-b border-r border-border-strong bg-surface-sunken px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-ink-muted';
const TD_BASE = 'whitespace-nowrap border-r border-border-strong px-3 py-2';

const VisitSummaryTable: React.FC<{ visits: GrowthVisitDetail[] }> = ({ visits }) => {
  const { t } = useTranslation('growth');
  const rows = buildRows(visits);

  /** Green for the good answer, red for the bad one — tinted so text stays dark. */
  const flagFill = (value: 'yes' | 'no' | null, goodIsYes: boolean) =>
    value == null
      ? undefined
      : lapCellFill(value === (goodIsYes ? 'yes' : 'no') ? 'green' : 'red', true);

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">{t('casePage.visitSummaryHint')}</p>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border">
        <table className="border-collapse text-sm" style={{ width: 'max-content', minWidth: '100%' }}>
          <thead className="sticky top-0 z-20">
            {/* group row */}
            <tr>
              <th colSpan={3} className={cn(TH_BASE, 'text-center')}>{t('casePage.groups.visit')}</th>
              <th colSpan={3} className={cn(TH_BASE, 'text-center')}>{t('casePage.groups.forms')}</th>
              <th colSpan={3} className={cn(TH_BASE, 'text-center')}>{t('casePage.groups.weight')}</th>
              <th colSpan={3} className={cn(TH_BASE, 'text-center')}>{t('casePage.groups.length')}</th>
              <th colSpan={3} className={cn(TH_BASE, 'text-center')}>{t('casePage.groups.wfl')}</th>
              <th colSpan={2} className={cn(TH_BASE, 'text-center')}>{t('casePage.groups.context')}</th>
            </tr>
            {/* column row */}
            <tr>
              <th className={cn(TH_BASE, 'text-right')}>#</th>
              <th className={cn(TH_BASE, 'text-left')}>{t('casePage.visitDate')}</th>
              <th className={cn(TH_BASE, 'text-left')}>{t('casePage.age')}</th>

              <th className={cn(TH_BASE, 'text-left')}>{t('casePage.forms')}</th>
              <th className={cn(TH_BASE, 'text-center text-success-600')} title={t('casePage.legendGreen')}>✓</th>
              <th className={cn(TH_BASE, 'text-center text-coral-700')} title={t('casePage.legendRed')}>✕</th>

              <th className={cn(TH_BASE, 'text-center')}>{t('casePage.weightKg')}</th>
              <th className={cn(TH_BASE, 'text-center')} title={t('summary.wfaz')}>WFAz</th>
              <th className={cn(TH_BASE, 'text-center')} title={t('casePage.deltaHint')}>Δ</th>

              <th className={cn(TH_BASE, 'text-center')}>{t('casePage.lengthCm')}</th>
              <th className={cn(TH_BASE, 'text-center')} title={t('summary.hfaz')}>HFAz</th>
              <th className={cn(TH_BASE, 'text-center')} title={t('casePage.deltaHint')}>Δ</th>

              <th className={cn(TH_BASE, 'text-center')} title={t('casePage.wflPairHint')}>{t('casePage.wflPair')}</th>
              <th className={cn(TH_BASE, 'text-center')} title={t('summary.wfhz')}>WFHz</th>
              <th className={cn(TH_BASE, 'text-center')} title={t('casePage.deltaHint')}>Δ</th>

              <th className={cn(TH_BASE, 'text-center')} title={t('casePage.breastfedFull')}>
                {t('casePage.breastfed')}
              </th>
              <th className={cn(TH_BASE, 'text-left')} title={t('casePage.otherFoodsFull')}>
                {t('casePage.otherFoods')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, index) => {
              const v = row.visit;
              return (
                <tr key={v.date} className="transition-colors hover:bg-surface-sunken/60">
                  <td className={cn(TD_BASE, 'text-right tabular-nums text-ink-faint')}>{index + 1}</td>
                  <td className={cn(TD_BASE, 'font-semibold text-ink')}>{v.date}</td>
                  <td className={cn(TD_BASE, 'text-ink-muted')}>
                    {v.age_days != null ? formatAge(v.age_days) : '—'}
                  </td>

                  <td className={cn(TD_BASE, 'text-ink-muted')}>{row.codes.join(' · ') || '—'}</td>
                  {/* Tinted, not solid, so the tally text keeps its contrast —
                      and the ink colours flip with the theme (a fixed dark
                      green would vanish on the dark-composited tint). */}
                  <td
                    className={cn(TD_BASE, 'text-center font-bold tabular-nums', GREEN_INK)}
                    style={{ backgroundColor: row.green > 0 ? lapCellFill('green', true) : undefined }}
                  >
                    {row.green || '—'}
                  </td>
                  <td
                    className={cn(TD_BASE, 'text-center font-bold tabular-nums', RED_INK)}
                    style={{ backgroundColor: row.red > 0 ? lapCellFill('red', true) : undefined }}
                  >
                    {row.red || '—'}
                  </td>

                  <td className={cn(TD_BASE, 'text-center tabular-nums text-ink')}>{fmtNum(v.weight, 3, '')}</td>
                  <td
                    className={cn(TD_BASE, 'text-center font-semibold tabular-nums', zCellInk(v.z.wfaz))}
                    style={{ backgroundColor: zCellFill(v.z.wfaz) }}
                  >
                    {fmtZ(v.z.wfaz)}
                  </td>
                  <td
                    className={cn(TD_BASE, 'text-center font-semibold tabular-nums', deltaCellInk(row.deltas.wfaz))}
                    style={{ backgroundColor: deltaCellFill(row.deltas.wfaz) }}
                  >
                    {fmtDelta(row.deltas.wfaz)}
                  </td>

                  <td className={cn(TD_BASE, 'text-center tabular-nums text-ink')}>{fmtNum(v.length, 1, '')}</td>
                  <td
                    className={cn(TD_BASE, 'text-center font-semibold tabular-nums', zCellInk(v.z.hfaz))}
                    style={{ backgroundColor: zCellFill(v.z.hfaz) }}
                  >
                    {fmtZ(v.z.hfaz)}
                  </td>
                  <td
                    className={cn(TD_BASE, 'text-center font-semibold tabular-nums', deltaCellInk(row.deltas.hfaz))}
                    style={{ backgroundColor: deltaCellFill(row.deltas.hfaz) }}
                  >
                    {fmtDelta(row.deltas.hfaz)}
                  </td>

                  <td className={cn(TD_BASE, 'text-center tabular-nums text-ink-muted')}>
                    {v.weight != null && v.length != null
                      ? `${v.weight.toFixed(3)} / ${v.length.toFixed(1)}`
                      : '—'}
                  </td>
                  <td
                    className={cn(TD_BASE, 'text-center font-semibold tabular-nums', zCellInk(v.z.wfhz))}
                    style={{ backgroundColor: zCellFill(v.z.wfhz) }}
                  >
                    {fmtZ(v.z.wfhz)}
                  </td>
                  <td
                    className={cn(TD_BASE, 'text-center font-semibold tabular-nums', deltaCellInk(row.deltas.wfhz))}
                    style={{ backgroundColor: deltaCellFill(row.deltas.wfhz) }}
                  >
                    {fmtDelta(row.deltas.wfhz)}
                  </td>

                  <td
                    className={cn(
                      TD_BASE, 'text-center font-semibold',
                      row.breastfed === 'yes' ? GREEN_INK : row.breastfed === 'no' ? RED_INK : 'text-ink',
                    )}
                    title={row.breastfedLabel ?? undefined}
                    style={{ backgroundColor: flagFill(row.breastfed, true) }}
                  >
                    {row.breastfed ? t(`casePage.${row.breastfed}`) : '—'}
                  </td>
                  <td
                    className={cn(TD_BASE, 'max-w-64 truncate text-left text-ink')}
                    title={row.otherFoods?.join(', ') || undefined}
                  >
                    {row.otherFoods == null ? (
                      <span className="text-ink-faint">—</span>
                    ) : row.otherFoods.length === 0 ? (
                      <span className="text-ink-muted">{t('casePage.nothingElse')}</span>
                    ) : (
                      row.otherFoods.join(', ')
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default VisitSummaryTable;
