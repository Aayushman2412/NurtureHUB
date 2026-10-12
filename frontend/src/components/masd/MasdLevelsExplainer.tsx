import React from 'react';
import { useTranslation } from 'react-i18next';
import { Layers } from 'lucide-react';
import { ADOPTION_TYPES, type MasdReport } from '../../api/masd';
import { Section } from '../results/InsightParts';
import { DataTable, Th } from './MasdCharts';
import { fmt1 } from '../../lib/masdDisplay';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
const LEVEL_COLORS = ['#2A7F8F', '#E85D4C', '#7C5CBF'];

/**
 * The three levels of expected activity side by side, with one made-up
 * learner worked through all three on this project's own tranches (review of
 * 12 Oct 2026: "take an example and show them pictorially … a comparative
 * table for level one, two and three").
 */
const MasdLevelsExplainer: React.FC<{ report: MasdReport }> = ({ report }) => {
  const { t } = useTranslation('masd');
  const ex = report.levels_example;
  const s = report.summary;
  const levels = [
    { n: 1, pct: s.intensity_pct, exp: s.ideal },
    { n: 2, pct: s.undertaken_pct ?? null, exp: s.undertaken_expected ?? 0 },
    { n: 3, pct: s.own_pct, exp: s.own_expected },
  ];
  const exNums = ex ? [ex.level1, ex.level2, ex.level3] : [];
  const top = Math.max(1, ...exNums);
  return (
    <Section icon={<Layers />} title={t('levels.title')} subtitle={t('levels.sub')}>
      <DataTable>
        <thead>
          <tr>
            <Th className="text-left" />
            {levels.map(l => <Th key={l.n} className="text-left">{t(`levels.name${l.n}`)}</Th>)}
          </tr>
        </thead>
        <tbody>
          {(['question', 'which', 'from', 'days'] as const).map(row => (
            <tr key={row}>
              <td className="px-3 py-2 font-semibold text-ink">{t(`levels.row.${row}`)}</td>
              {levels.map(l => <td key={l.n} className="px-3 py-2 text-sm text-ink">{t(`levels.l${l.n}.${row}`)}</td>)}
            </tr>
          ))}
          <tr className="bg-surface-sunken/50">
            <td className="px-3 py-2 font-semibold text-ink">{t('levels.row.project')}</td>
            {levels.map(l => (
              <td key={l.n} className="px-3 py-2 text-sm text-ink">
                <b>{fmt1(l.pct)}</b> <span className="text-ink-muted">{t('levels.ofExpected', { n: Math.round(l.exp).toLocaleString() })}</span>
              </td>
            ))}
          </tr>
        </tbody>
      </DataTable>

      {ex && (
        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2 [&>*]:min-w-0">
          <div>
            <h4 className="mb-1 text-base font-bold text-ink">{t('levels.exampleTitle')}</h4>
            <p className="mb-2 text-sm text-ink">
              {t('levels.exampleAsked', {
                n: ex.asked_total,
                types: ADOPTION_TYPES.filter(k => ex.asked[k]).map(k => `${ex.asked[k]} ${t(`expected.kind.${k}`)}`).join(', '),
                tranches: ex.tranches.length,
              })}
            </p>
            <ul className="space-y-1.5 text-sm text-ink">
              {ex.cases.map((c, i) => (
                <li key={i} className="rounded-lg bg-surface-sunken px-3 py-2">
                  <b>{t('levels.exampleCase', { n: i + 1, type: t(`expected.kind.${c.type}`), tranche: c.tranche, date: fmtDate(c.adopted) })}</b>
                  {c.baby_age_days != null ? ` ${t('levels.babyAge', { n: c.baby_age_days })}` : ` ${t('levels.pregnant')}`}
                  <div className="text-xs text-ink-muted">
                    {t('levels.exampleCounts', { l2: c.level2, fu: c.fu_days ?? 0, l3: c.level3, own: c.own_days })}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="mb-2 text-base font-bold text-ink">{t('levels.pictureTitle')}</h4>
            <div className="space-y-3">
              {exNums.map((v, i) => (
                <div key={i}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-semibold text-ink">{t(`levels.name${i + 1}`)}</span>
                    <span className="tabular-nums text-ink">{t('levels.formsDue', { n: v })}</span>
                  </div>
                  <div className="h-5 w-full max-w-xl rounded-full bg-surface-sunken">
                    <div className="h-5 rounded-full" style={{ width: `${(100 * v) / top}%`, background: LEVEL_COLORS[i] }} />
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">{t(`levels.pictureNote${i + 1}`)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Section>
  );
};

export default MasdLevelsExplainer;
