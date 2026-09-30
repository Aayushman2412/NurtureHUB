import React from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, ArrowRight, Hourglass, Lightbulb, PhoneCall, Users } from 'lucide-react';
import type { MasdReport } from '../../api/masd';
import { BigNumber, Kpi, KpiRow, Section } from '../results/InsightParts';
import { Ring, StackedBar } from '../results/InsightCharts';
import MasdFindings from './MasdFindings';
import { DataTable, Th, TrendLine } from './MasdCharts';
import { fmt1, MASD_COLORS, rateTone } from '../../lib/masdDisplay';

const MasdOverview: React.FC<{ report: MasdReport; onOpenLearners: () => void; onOpenFlags: () => void }> = ({
  report, onOpenLearners, onOpenFlags,
}) => {
  const { t } = useTranslation('masd');
  const s = report.summary;
  const ex = report.outcomes.exclusions;
  const flags = report.flags.summary;
  const weeks = report.weekly.map(w => ({
    label: new Date(w.week).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }),
    a: w.total,
    b: w.adoptions,
  }));

  return (
    <div className="space-y-5">
      <KpiRow count={6}>
        <Kpi
          visual={<Ring value={Math.min(s.fulfilment_pct ?? 0, 100)} color={rateTone(s.fulfilment_pct ?? 0)}>{fmt1(s.fulfilment_pct)}</Ring>}
          label={t('kpi.fulfilment')}
          value={t('kpi.fulfilmentSub', { n: s.adoptions.toLocaleString(), target: s.target.toLocaleString() })}
        />
        <Kpi
          visual={<Ring value={Math.min(s.intensity_pct ?? 0, 100)} color={rateTone(s.intensity_pct ?? 0)}>{fmt1(s.intensity_pct)}</Ring>}
          label={t('kpi.intensity')}
          value={t('kpi.intensitySub', { n: s.activities.toLocaleString(), ideal: Math.round(s.ideal).toLocaleString() })}
        />
        <Kpi
          visual={<BigNumber value={s.nil_days_avg == null ? '—' : s.nil_days_avg.toFixed(1)}
            tone={(s.nil_days_avg ?? 0) >= 14 ? 'bad' : 'neutral'} />}
          label={t('kpi.nilDays')}
          value={t('kpi.nilDaysSub')}
        />
        <Kpi
          visual={<Ring value={Math.min(s.own_pct ?? 0, 100)} color={rateTone(s.own_pct ?? 0)}>{fmt1(s.own_pct)}</Ring>}
          label={t('kpi.own')}
          value={t('kpi.ownSub', { n: s.own_actual.toLocaleString(), expected: s.own_expected.toLocaleString() })}
        />
        <button type="button" onClick={onOpenFlags} className="cursor-pointer rounded-xl text-left transition hover:ring-2 hover:ring-coral-300">
          <Kpi
            visual={<BigNumber value={flags.edd_passed.toLocaleString()} tone={flags.edd_passed ? 'bad' : 'good'} />}
            label={t('kpi.overdue')}
            value={t('kpi.overdueSub', { n: flags.open_pregnancies.toLocaleString() })}
          />
        </button>
        <Kpi
          visual={<BigNumber value={ex.included.total.toLocaleString()} />}
          label={t('kpi.cohort')}
          value={t('kpi.cohortSub', { pct: fmt1(ex.inclusion_pct) })}
        />
      </KpiRow>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5 [&>*]:min-w-0">
        <Section className="lg:col-span-3" icon={<Lightbulb />} title={t('overview.findingsTitle')} subtitle={t('overview.findingsSub')}>
          <MasdFindings findings={[...(report.insights.overview ?? []), ...(report.insights.takeaways ?? []).slice(1)]} />
        </Section>
        <Section className="lg:col-span-2" icon={<Users />} title={t('overview.mixTitle')} subtitle={t('overview.mixSub')}>
          <StackedBar
            height="h-6"
            parts={[
              { key: 'anc', label: t('types.anc'), value: s.mix.anc, color: MASD_COLORS.anc },
              { key: 'pnc_lt5', label: t('types.pnc_lt5'), value: s.mix.pnc_lt5, color: MASD_COLORS.pnc_lt5 },
              { key: 'pnc_ge5', label: t('types.pnc_ge5'), value: s.mix.pnc_ge5, color: MASD_COLORS.pnc_ge5 },
              ...(s.mix.unknown ? [{ key: 'unknown', label: t('types.unknown'), value: s.mix.unknown, color: MASD_COLORS.unknown }] : []),
            ]}
          />
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-surface-sunken p-3">
              <dt className="text-xs text-ink-muted">{t('overview.zeroAdoptions')}</dt>
              <dd className="text-lg font-bold tabular-nums text-ink">{s.zero_adoptions}</dd>
            </div>
            <div className="rounded-lg bg-surface-sunken p-3">
              <dt className="text-xs text-ink-muted">{t('overview.noActivity')}</dt>
              <dd className="text-lg font-bold tabular-nums text-ink">{s.no_activity}</dd>
            </div>
          </dl>
          {s.non_f2f_learners_with_cases > 0 && (
            <p className="mt-4 text-xs text-ink-muted">
              {t('overview.nonF2f', { n: s.non_f2f_learners_with_cases, cases: s.non_f2f_cases })}
            </p>
          )}
        </Section>
      </div>

      {weeks.length > 1 && (
        <Section icon={<Activity />} title={t('overview.weeklyTitle')} subtitle={t('overview.weeklySub')}>
          <TrendLine points={weeks} labelA={t('overview.activities')} labelB={t('overview.newAdoptions')} />
        </Section>
      )}

      <Section
        icon={<PhoneCall />}
        title={t('attention.title', { count: report.attention.length })}
        subtitle={t('attention.sub')}
        actions={report.attention.length > 6 ? (
          <button type="button" onClick={onOpenLearners}
            className="inline-flex cursor-pointer items-center gap-1 text-sm font-semibold text-primary-ink hover:underline">
            {t('attention.seeAll')} <ArrowRight className="size-4" />
          </button>
        ) : undefined}
      >
        {report.attention.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('attention.none')}</p>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <Th className="text-left">{t('table.learner')}</Th>
                <Th>{t('table.block')}</Th>
                <Th>{t('table.cadre')}</Th>
                <Th>{t('table.adoptions')}</Th>
                <Th>{t('table.intensity')}</Th>
                <Th>{t('table.nilDays')}</Th>
                <Th className="text-left">{t('attention.why')}</Th>
              </tr>
            </thead>
            <tbody>
              {report.attention.slice(0, 6).map(a => (
                <tr key={a.id}>
                  <td className="px-3 py-2 font-medium text-ink">{a.name}</td>
                  <td className="px-3 py-2 text-center text-ink-muted">{a.block}</td>
                  <td className="px-3 py-2 text-center text-ink-muted">{a.role_group}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{a.adoptions}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{fmt1(a.intensity_pct)}</td>
                  <td className="px-3 py-2 text-center tabular-nums">
                    {a.nil_days == null ? '—' : <span className="inline-flex items-center gap-1"><Hourglass className="size-3.5 text-ink-faint" />{a.nil_days}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {a.reasons.map(r => (
                        <span key={r} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-500">
                          {t(`attention.reasons.${r}`)}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Section>
    </div>
  );
};

export default MasdOverview;
