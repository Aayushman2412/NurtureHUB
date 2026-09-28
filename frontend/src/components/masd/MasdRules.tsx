import React from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, CalendarDays, ClipboardCheck, Scale, Sigma } from 'lucide-react';
import { ACTIVITY_KEYS, type MasdReport } from '../../api/masd';
import { Section } from '../results/InsightParts';
import { DataTable, Th } from './MasdCharts';

const COLS = [['anc', 'types.anc'], ['pnc_lt5', 'rules.child_lt5'], ['pnc_ge5', 'rules.child_ge5'], ['nurse_lt5', 'rules.nurse']] as const;

/** The programme rules the report applies, straight from the backend. */
const MasdRules: React.FC<{ report: MasdReport }> = ({ report }) => {
  const { t } = useTranslation('masd');
  const r = report.rules;
  const cal = report.calendar;
  const std = Object.values(r.ideal_learner.standard).reduce((a, b) => a + b, 0);
  const nurse = Object.values(r.ideal_learner.nurse).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-5">
      <Section icon={<CalendarDays />} title={t('rules.calendarTitle')} subtitle={cal.inferred ? t('calendar.inferred') : undefined}>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3 [&>*]:min-w-0">
          <div className="rounded-lg bg-surface-sunken p-3"><dt className="text-xs text-ink-muted">{t('calendar.training')}</dt><dd className="font-semibold">{cal.training_date ?? '—'}</dd></div>
          <div className="rounded-lg bg-surface-sunken p-3"><dt className="text-xs text-ink-muted">{t('calendar.tranche2')}</dt><dd className="font-semibold">{cal.tranche2_start ?? '—'}</dd></div>
          <div className="rounded-lg bg-surface-sunken p-3"><dt className="text-xs text-ink-muted">{t('rules.due')}</dt>
            <dd className="font-semibold">{t('rules.dueValue', { t1: Math.round(cal.due_fraction.t1 * 100), t2: Math.round(cal.due_fraction.t2 * 100) })}</dd></div>
        </dl>
        <p className="mt-3 text-sm text-ink-muted">{t('rules.prorataNote')}</p>
      </Section>

      <Section icon={<Scale />} title={t('rules.idealTitle')} subtitle={t('rules.idealSub', { std, nurse })}>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 [&>*]:min-w-0">
          {(['1', '2'] as const).map(tr => {
            const table = r.ideal_per_adoption[tr];
            return (
              <div key={tr}>
                <h4 className="mb-2 text-sm font-semibold text-ink">
                  {t('rules.tranche', { n: tr, months: r.min_follow_up_months[tr] })}
                </h4>
                <DataTable>
                  <thead>
                    <tr><Th className="text-left">{t('rules.activity')}</Th>{COLS.map(([k, label]) => <Th key={k}>{t(label)}</Th>)}</tr>
                  </thead>
                  <tbody>
                    {ACTIVITY_KEYS.map(a => (
                      <tr key={a}>
                        <td className="px-3 py-2">{t(`activities.${a}`)}</td>
                        {COLS.map(([k]) => {
                          const n = (table[k]?.[a] ?? 0) * (k === 'nurse_lt5' ? 3 : 1);
                          return <td key={k} className="px-3 py-2 text-center tabular-nums">{n || ''}</td>;
                        })}
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className="px-3 py-2">{t('rules.overall')}</td>
                      {COLS.map(([k]) => (
                        <td key={k} className="px-3 py-2 text-center tabular-nums">
                          {Object.values(table[k] ?? {}).reduce((x, y) => x + (y ?? 0), 0) * (k === 'nurse_lt5' ? 3 : 1)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </DataTable>
              </div>
            );
          })}
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <Section icon={<BookOpen />} title={t('rules.termsTitle')}>
          <dl className="space-y-2.5 text-sm">
            {(['adoption', 'types', 'target', 'intensity', 'nil', 'bvavlv', 'mtfl', 'bands', 'malnutrition'] as const).map(k => (
              <div key={k}>
                <dt className="font-semibold text-ink">{t(`rules.terms.${k}.term`)}</dt>
                <dd className="text-ink-muted">{t(`rules.terms.${k}.meaning`, { days: r.five_months_days, target: r.target })}</dd>
              </div>
            ))}
          </dl>
        </Section>
        <Section icon={<ClipboardCheck />} title={t('rules.checksTitle')} subtitle={t('rules.checksSub')}>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink">
            {r.exclusion_reasons.map(([key, label]) => <li key={key}>{t(`reasons.${key}`, { defaultValue: label })}</li>)}
          </ol>
          <h4 className="mt-5 flex items-center gap-2 text-sm font-semibold text-ink"><Sigma className="size-4" />{t('rules.complianceTitle')}</h4>
          <ul className="mt-2 space-y-1 text-sm text-ink-muted">
            <li>{t('bands.lt6')}: {t('outcomes.complianceRule', { visits: r.compliance.lt6.min_visits, days: r.compliance.lt6.min_follow_up_days })}</li>
            <li>{t('bands.m6_11')}: {t('outcomes.complianceRule', { visits: r.compliance.m6_11.min_visits, days: r.compliance.m6_11.min_follow_up_days })}</li>
          </ul>
        </Section>
      </div>
    </div>
  );
};

export default MasdRules;
