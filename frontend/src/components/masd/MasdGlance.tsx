import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Baby, BookOpen, CalendarClock, ClipboardCheck, HeartPulse, Sparkles, TrendingUp, Users } from 'lucide-react';
import type { MasdReport } from '../../api/masd';
import { Section } from '../results/InsightParts';
import { CumulativeChart } from './MasdCharts';
import { byGrain, fmt1, MASD_COLORS, rateTone } from '../../lib/masdDisplay';

const Fact: React.FC<{ icon: React.ReactNode; big: string; color?: string; title: string; text: string }> = ({ icon, big, color, title, text }) => (
  <div className="flex gap-4 rounded-2xl border border-border bg-surface p-5">
    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-coral-50 text-coral-600 dark:bg-coral-500/15 dark:text-coral-300 [&>svg]:size-6">{icon}</span>
    <div className="min-w-0">
      <div className="font-display text-3xl font-extrabold tabular-nums" style={color ? { color } : undefined}>{big}</div>
      <div className="mt-0.5 text-base font-bold text-ink">{title}</div>
      <p className="mt-1 text-sm leading-relaxed text-ink">{text}</p>
    </div>
  </div>
);

/**
 * The project in plain words, for someone seeing it for the first time
 * (review of 12 Oct 2026): a handful of numbers, each with one or two
 * sentences on what it means, one picture of progress, and the few words the
 * other pages use. The other pages stay for the team.
 */
const MasdGlance: React.FC<{ report: MasdReport; onMore: () => void }> = ({ report, onMore }) => {
  const { t } = useTranslation('masd');
  const s = report.summary;
  const uw = report.outcomes.prevalence.overall;
  const weeks = useMemo(() => byGrain(report.cumulative?.days ?? [], 'week'), [report.cumulative]);
  const labels = weeks.map(d => new Date(`${d.date}T00:00:00Z`).toLocaleDateString(undefined, { day: '2-digit', month: 'short', timeZone: 'UTC' }));
  const registered = s.learners_all;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 font-display text-xl font-extrabold text-ink"><Sparkles className="size-5 text-coral-600" />{t('glance.title', { name: report.project.name })}</h2>
        <p className="mt-2 max-w-4xl text-base leading-relaxed text-ink">{t('glance.intro')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Fact icon={<Users />} big={s.learners.toLocaleString()} title={t('glance.trainedTitle')}
          text={t('glance.trainedText', { n: s.learners, total: registered })} />
        <Fact icon={<Baby />} big={fmt1(s.fulfilment_pct)} color={rateTone(s.fulfilment_pct ?? 0)} title={t('glance.adoptTitle')}
          text={t('glance.adoptText', { n: s.adoptions.toLocaleString(), target: s.target.toLocaleString() })} />
        <Fact icon={<ClipboardCheck />} big={fmt1(s.intensity_pct)} color={rateTone(s.intensity_pct ?? 0)} title={t('glance.visitsTitle')}
          text={t('glance.visitsText', { n: s.activities.toLocaleString(), ideal: Math.round(s.ideal).toLocaleString() })} />
        <Fact icon={<ClipboardCheck />} big={fmt1(s.undertaken_pct ?? null)} color={rateTone(s.undertaken_pct ?? 0)} title={t('glance.ownTitle')}
          text={t('glance.ownText', { n: (s.undertaken_actual ?? 0).toLocaleString(), expected: (s.undertaken_expected ?? 0).toLocaleString() })} />
        <Fact icon={<CalendarClock />} big={s.nil_days_median == null ? '—' : t('glance.days', { n: s.nil_days_median })}
          title={t('glance.quietTitle')} text={t('glance.quietText', { q1: s.nil_days_q1 ?? '—', q3: s.nil_days_q3 ?? '—' })} />
        {uw.n > 0 && uw.underweight.av != null && uw.underweight.lv != null && (
          <Fact icon={<HeartPulse />} big={`${fmt1(uw.underweight.av)} → ${fmt1(uw.underweight.lv)}`} title={t('glance.growthTitle')}
            text={t('glance.growthText', { n: uw.n.toLocaleString(), av: fmt1(uw.underweight.av), lv: fmt1(uw.underweight.lv) })} />
        )}
      </div>

      {weeks.length > 1 && (
        <Section icon={<TrendingUp />} title={t('glance.chartTitle')} subtitle={t('glance.chartSub')}>
          <CumulativeChart labels={labels} lines={[
            { key: 'exp', label: t('glance.asked'), color: MASD_COLORS.adoption, dashed: true, step: true, values: weeks.map(d => d.expected_adoptions) },
            { key: 'act', label: t('glance.made'), color: '#1F5560', values: weeks.map(d => d.adoptions) },
          ]} />
        </Section>
      )}

      <Section icon={<BookOpen />} title={t('glance.wordsTitle')}>
        <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(['learner', 'adoption', 'types', 'tranche', 'forms', 'levels', 'dyad', 'visits'] as const).map(k => (
            <div key={k} className="rounded-xl bg-surface-sunken p-3">
              <dt className="text-sm font-bold text-ink">{t(`glance.words.${k}.term`)}</dt>
              <dd className="mt-0.5 text-sm text-ink">{t(`glance.words.${k}.meaning`)}</dd>
            </div>
          ))}
        </dl>
        <button type="button" onClick={onMore} className="mt-4 cursor-pointer text-sm font-semibold text-primary-ink hover:underline">
          {t('glance.more')}
        </button>
      </Section>
    </div>
  );
};

export default MasdGlance;
