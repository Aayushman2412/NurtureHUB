import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoveHorizontal } from 'lucide-react';
import type { FormResponseDetail } from '../../lib/flowTypes';
import { lapCellFill } from '../../lib/growthDisplay';
import { GREEN_INK, RED_INK } from './VisitSummaryTable';
import { cn } from '../../utils/cn';

/**
 * One form, question × visit (review of 17 Oct 2026). Sir: "I can't keep a
 * track between successive visits" going into each form one by one — so every
 * form is a table, its visits side by side:
 *
 * - LAP forms (breastfeeding, complementary feeding) show ✓ / ✕ per answer,
 *   with the points correct and the percentage ON TOP, so progress reads at a
 *   glance; the other forms show what was recorded.
 * - The "assessment date" question is not repeated as a row — the date heads
 *   its column.
 * - Narrow columns: VISIBLE visit slots fit one laptop screen at 100% zoom;
 *   slots not yet visited stay as grey placeholders, and when a case has
 *   more visits a slider moves along them (latest first in view).
 */

const VISIBLE = 6;

type Kind = 'lap' | 'values';
type Verdict = 'green' | 'red' | 'neutral' | null;

interface Row {
  key: string;
  question: string;
  cells: Record<string, { verdict: Verdict; text: string }>;
}

const isDateEcho = (question: string, value: string, date: string) => /date/i.test(question) && value === date;

const answerText = (value: string | null, labels: string[]) => {
  // Matrix questions store their grid as JSON in `value`; their readable form
  // is the option labels, which the server derived from it.
  if (value && !value.trim().startsWith('{')) return value;
  return labels.join('; ');
};

function build(responses: FormResponseDetail[]) {
  const sorted = [...responses].sort(
    (a, b) => a.assessment_date.localeCompare(b.assessment_date) || a.id - b.id,
  );
  const dates: string[] = [];
  const byDate = new Map<string, FormResponseDetail>();
  const rows = new Map<string, Row>();
  for (const response of sorted) {
    const date = response.assessment_date;
    if (!dates.includes(date)) dates.push(date);
    byDate.set(date, response);   // same-date resubmission: the later one wins
    for (const answer of response.answers_json) {
      const labels = (answer.selected ?? []).map(s => s.label).filter(Boolean);
      const text = answerText(answer.value, labels);
      if (isDateEcho(answer.question, answer.value ?? labels[0] ?? '', date)) continue;
      const key = answer.nodeId || answer.question;
      if (!rows.has(key)) rows.set(key, { key, question: answer.question, cells: {} });
      const verdicts = (answer.selected ?? []).map(s => s.verdict).filter(Boolean);
      const answered = answer.value != null || labels.length > 0;
      const verdict: Verdict = verdicts.includes('red') ? 'red'
        : verdicts.includes('green') ? 'green'
          : answered ? 'neutral' : null;
      rows.get(key)!.cells[date] = { verdict, text };
    }
  }
  return { dates, byDate, rows: [...rows.values()] };
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);

/** `kind` is worked out from the answers when not given: a form whose
 *  answers carry LAP verdicts is read as ✓ / ✕, any other as values. */
const VisitMatrix: React.FC<{ responses: FormResponseDetail[]; kind?: Kind }> = ({ responses, kind: forced }) => {
  const { t } = useTranslation('growth');
  const { dates, byDate, rows } = useMemo(() => build(responses), [responses]);
  const kind: Kind = forced ?? (rows.some(r => Object.values(r.cells).some(c => c.verdict === 'green' || c.verdict === 'red'))
    ? 'lap' : 'values');
  const maxStart = Math.max(0, dates.length - VISIBLE);
  const [start, setStart] = useState(maxStart);
  const from = Math.min(start, maxStart);
  const shown = dates.slice(from, from + VISIBLE);
  const placeholders = Math.max(0, VISIBLE - shown.length);
  // Six visits and the question fit a 1366-px laptop at 100% zoom.
  const colW = kind === 'lap' ? 'w-[6.5rem] min-w-[6.5rem]' : 'w-[7.5rem] min-w-[7.5rem]';
  const qW = kind === 'lap' ? 'w-64 min-w-64 max-w-80 md:w-80 md:min-w-80' : 'w-56 min-w-56 max-w-56';

  const score = (date: string) => {
    const s = byDate.get(date)?.summary_json;
    if (!s) return null;
    const scored = (s.green ?? 0) + (s.red ?? 0);
    return scored > 0 ? { n: s.green ?? 0, of: scored, pct: pct(s.green ?? 0, scored) } : null;
  };
  const protein = (date: string) => byDate.get(date)?.summary_json?.protein ?? null;
  const hasScore = kind === 'lap' && shown.some(d => score(d));
  const hasProtein = shown.some(d => protein(d));

  const cellTitle = (v: Verdict) =>
    v === 'green' ? t('casePage.legendGreen') : v === 'red' ? t('casePage.legendRed')
      : v === 'neutral' ? t('casePage.legendNeutral') : t('casePage.legendNotAsked');

  return (
    <div className="space-y-2">
      {dates.length > VISIBLE && (
        <label className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
          <MoveHorizontal className="size-4" aria-hidden />
          <span className="font-semibold">
            {t('casePage.visitWindow', { from: from + 1, to: from + shown.length, total: dates.length })}
          </span>
          <input
            type="range" min={0} max={maxStart} value={from}
            onChange={e => setStart(Number(e.target.value))}
            aria-label={t('casePage.visitSlider')}
            className="w-48 accent-(--primary)"
          />
        </label>
      )}
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border-strong">
        <table
          className="border-collapse text-sm [&_td]:border [&_td]:border-border-strong [&_th]:border [&_th]:border-border-strong"
          style={{ width: 'max-content' }}
        >
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-10 w-10 bg-surface-sunken px-2 py-2 text-right text-[13px] font-bold text-ink-muted">#</th>
              <th className={cn('sticky left-10 z-10 bg-surface-sunken px-3 py-2 text-left text-[13px] font-bold uppercase tracking-wide text-ink-muted', qW)}>
                {t('casePage.question')}
              </th>
              {shown.map((date, i) => (
                <th key={date} className={cn(colW, 'bg-surface-sunken px-2 py-2 text-center text-[13px] font-semibold text-ink')}>
                  <span className="block text-[11px] font-normal text-ink-faint">{t('casePage.visitN', { n: from + i + 1 })}</span>
                  {date}
                </th>
              ))}
              {Array.from({ length: placeholders }, (_, i) => (
                <th key={`ph${i}`} className={cn(colW, 'bg-surface-sunken/60 px-2 py-2 text-center text-[13px] font-normal text-ink-faint')}>
                  {t('casePage.visitN', { n: dates.length + i + 1 })}
                </th>
              ))}
            </tr>
            {hasScore && (
              <tr>
                <th className="sticky left-0 z-10 bg-surface px-2 py-1.5" />
                <th className="sticky left-10 z-10 bg-surface px-3 py-1.5 text-left text-sm font-bold text-ink">{t('casePage.pointsCorrect')}</th>
                {shown.map(date => {
                  const s = score(date);
                  return (
                    <th key={date} className="bg-surface px-2 py-1.5 text-center text-sm font-bold tabular-nums text-ink">
                      {s ? <>{s.n}/{s.of}<span className="block text-xs font-semibold text-ink-muted">{s.pct}%</span></> : '—'}
                    </th>
                  );
                })}
                {Array.from({ length: placeholders }, (_, i) => <th key={`ph${i}`} className="bg-surface-sunken/60" />)}
              </tr>
            )}
            {hasProtein && (
              <tr>
                <th className="sticky left-0 z-10 bg-surface px-2 py-1.5" />
                <th className="sticky left-10 z-10 bg-surface px-3 py-1.5 text-left text-sm font-bold text-ink">{t('casePage.protein24')}</th>
                {shown.map(date => {
                  const p = protein(date);
                  return (
                    <th key={date} className="bg-surface px-2 py-1.5 text-center text-sm font-bold tabular-nums text-ink">
                      {p ? <>{p.total24} g<span className="block text-xs font-semibold text-ink-muted">{t('casePage.proteinAvg', { g: p.dailyAvg })}</span></> : '—'}
                    </th>
                  );
                })}
                {Array.from({ length: placeholders }, (_, i) => <th key={`ph${i}`} className="bg-surface-sunken/60" />)}
              </tr>
            )}
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.key}>
                <td className="sticky left-0 z-10 w-10 bg-surface px-2 py-1.5 text-right text-[13px] tabular-nums text-ink-faint">{index + 1}</td>
                <td className={cn('sticky left-10 z-10 bg-surface px-3 py-1.5 text-sm text-ink', qW)}>{row.question}</td>
                {shown.map(date => {
                  const cell = row.cells[date];
                  const v = cell?.verdict ?? null;
                  if (kind === 'lap') {
                    return (
                      <td
                        key={date} title={cellTitle(v)}
                        className={cn('px-2 py-1.5 text-center text-base font-bold leading-none', v === 'green' && GREEN_INK, v === 'red' && RED_INK)}
                        style={{ backgroundColor: v === 'neutral' || v === null ? undefined : lapCellFill(v, true) }}
                      >
                        {v === 'green' ? '✓' : v === 'red' ? '✕' : v === 'neutral' ? (cell?.text ? <span className="text-xs font-normal text-ink">{cell.text}</span> : '•') : '—'}
                      </td>
                    );
                  }
                  return (
                    <td
                      key={date}
                      className={cn('px-2 py-1.5 align-top text-[13px] leading-snug text-ink', v === 'green' && GREEN_INK, v === 'red' && RED_INK)}
                      style={{ backgroundColor: v === 'green' || v === 'red' ? lapCellFill(v, true) : undefined }}
                    >
                      {cell?.text || <span className="text-ink-faint">—</span>}
                    </td>
                  );
                })}
                {Array.from({ length: placeholders }, (_, i) => <td key={`ph${i}`} className="bg-surface-sunken/60" />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default VisitMatrix;
