import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calculator, ChartColumn, ChartScatter, Hourglass, Layers3, ListChecks, Target, Timer } from 'lucide-react';
import {
  ACTIVITY_KEYS, ADOPTION_TYPES, OWN_BANDS, UPTAKE_BUCKETS,
  type MasdGroup, type MasdReport, type OwnBand, type Targets, type UptakeBucket, type UptakeGroup, type UptakeGroupKey,
} from '../../api/masd';
import { ChipRow, Kpi, KpiRow, Section } from '../results/InsightParts';
import { Ring, StackedBar } from '../results/InsightCharts';
import MasdFindings from './MasdFindings';
import MasdBaseline from './MasdBaseline';
import { BubblePlot, DataTable, GroupedColumns, RateCell, Th } from './MasdCharts';
import { averageLines, fmt1, MASD_COLORS, rateTone } from '../../lib/masdDisplay';
import { aggregate, applyFilters, splitBy, type MasdAgg, type TypeAgg } from '../../lib/masdSplit';
import type { MasdSplitState } from './MasdSplitBar';
import RateLegend from './RateLegend';

type BandSplit = 'blocks' | 'departments' | 'roles';
/** The adoption kinds a chart can show: the three types of the rest of the
 *  learners, and a Staff Nurse's PNC <5M on its own (review of 6 Oct 2026). */
type Kind = 'anc' | 'pnc_lt5' | 'pnc_ge5' | 'sn';
const KINDS: Kind[] = ['anc', 'pnc_lt5', 'pnc_ge5', 'sn'];
const kindOf = (g: MasdAgg, k: Kind): TypeAgg => (k === 'sn' ? g.nurse_lt5 : g.by_type[k]);
const MIN_FOR_RANK = 3;

const BAND_COLORS: Record<OwnBand, string> = {
  none: '#8E3B2F', b1_20: '#D6453D', b21_40: '#E0A11B', b41_60: '#C9B458', b61_80: '#7FB069', b81_100: '#2F9E56',
};
// When an adoption for a tranche came: early is good, never is the worry.
const UPTAKE_COLORS: Record<UptakeBucket, string> = {
  before: '#2A7F8F', d7: '#2F9E56', d15: '#7FB069', d30: '#E0A11B', later: '#D6453D', not_yet: '#A8A29E',
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
const iqr = (m: number | null, a: number | null, b: number | null, days: (n: number) => string) =>
  m == null ? '—' : `${days(m)} (${a ?? '—'}–${b ?? '—'})`;

/**
 * Expected activity — three levels (review of 6 Oct 2026):
 *  1. ideal: the targets × the LAP table at each tranche's follow-up (126 per
 *     learner, 99 per Staff Nurse at Jalna on 7 Oct);
 *  2. for the adoptions actually taken: the same table, read for the types
 *     and tranches the learner did adopt;
 *  3. each case by its own dates (a preview of the per-case analysis).
 * Then how quickly each tranche was taken up, by the rest of the learners and
 * Staff Nurses, adoption by adoption.
 */
const MasdExpected: React.FC<{ report: MasdReport; split: MasdSplitState }> = ({ report, split }) => {
  const { t } = useTranslation('masd');
  const s = report.summary;
  const cal = report.calendar;
  const [kind, setKind] = useState<Kind>('pnc_lt5');
  const [bandSplit, setBandSplit] = useState<BandSplit>('departments');
  const [upGroup, setUpGroup] = useState<UptakeGroupKey>('all');

  const learners = useMemo(() => applyFilters(report.learners.filter(l => l.f2f), split.filters), [report.learners, split.filters]);
  const groups = useMemo(() => splitBy(learners, split.dim), [learners, split.dim]);
  const total = useMemo(() => aggregate(learners, 'total', t('table.total')), [learners, t]);
  const word = t(`splitDims.${split.dim}`);

  const ranked = groups.filter(g => g.learners >= MIN_FOR_RANK && kindOf(g, kind).activity_pct != null);
  const best = ranked.length >= 2 ? ranked.reduce((a, b) => (kindOf(b, kind).activity_pct! > kindOf(a, kind).activity_pct! ? b : a)) : null;
  const worst = ranked.length >= 2 ? ranked.reduce((a, b) => (kindOf(b, kind).activity_pct! < kindOf(a, kind).activity_pct! ? b : a)) : null;

  const example = cal.batches[0];
  const tranches = useMemo(() => example?.expected.tranches ?? [], [example]);
  const sameClock = new Set(cal.batches.map(b => b.tranche_fu.join(','))).size <= 1;
  const namedBatches = cal.batches.filter(b => b.id != null);
  const idealRol = cal.tranches.reduce((a, tr) => a + tr.community.total, 0);
  const idealSn = cal.tranches.reduce((a, tr) => a + tr.nurse.total, 0);
  const asked = (a: Targets) => {
    const parts = ADOPTION_TYPES.filter(k => a[k]).map(k => `+${a[k]} ${t(`settings.target.${k}`)}`);
    if (a.nurse) parts.push(t('expected.askedNurse', { n: a.nurse }));
    return parts.join(' · ') || '—';
  };
  const exampleText = useMemo(() => tranches.map(tr => {
    const com = tr.community;
    const parts = ADOPTION_TYPES.filter(k => com.by_type[k]).map(k => {
      const v = com.by_type[k]!;
      const forms = ACTIVITY_KEYS.filter(a => (v.forms[a] ?? 0) > 0)
        .map(a => `${v.forms[a]} ${t(`activities.${a}`).toLowerCase()}`).join(' + ');
      return t('expected.exampleType', { n: v.adoptions, type: t(`types.${k}`), forms: forms || t('expected.nothingYet') });
    });
    return t('expected.exampleTranche', { n: tr.step, days: tr.fu_days ?? 0, parts: parts.join('; ') });
  }), [tranches, t]);
  const uptake = report.uptake.filter(u => u.learners > 0);
  const upOf = (u: (typeof uptake)[number]): UptakeGroup | null => u.groups?.[upGroup] ?? null;
  const days = (n: number) => t('expected.daysN', { n });

  const bandGroups = (bandSplit === 'departments' ? report.departments.filter(g => g.key !== 'total') : report[bandSplit])
    .filter(g => g.learners > 0 && g.own_banded > 0);

  const typeSeries = [
    { key: 'adopt', label: t('activity.adoptionPct'), color: MASD_COLORS.adoption, values: KINDS.map(k => kindOf(total, k).adoption_pct) },
    { key: 'act', label: t('activity.activityPct'), color: MASD_COLORS.activity, values: KINDS.map(k => kindOf(total, k).activity_pct) },
  ];
  const groupSeries = [
    { key: 'adopt', label: t('activity.adoptionPct'), color: MASD_COLORS.adoption, values: groups.map(g => kindOf(g, kind).adoption_pct) },
    { key: 'act', label: t('activity.activityPct'), color: MASD_COLORS.activity, values: groups.map(g => kindOf(g, kind).activity_pct) },
  ];

  return (
    <div className="space-y-5">
      <MasdBaseline report={report} />
      <KpiRow count={4}>
        <Kpi
          visual={<Ring value={Math.min(s.fulfilment_pct ?? 0, 100)} color={rateTone(s.fulfilment_pct ?? 0)}>{fmt1(s.fulfilment_pct)}</Ring>}
          label={t('kpi.fulfilment')}
          value={t('kpi.fulfilmentSub', { n: s.adoptions.toLocaleString(), target: s.target.toLocaleString() })}
        />
        <Kpi
          visual={<Ring value={Math.min(s.intensity_pct ?? 0, 100)} color={rateTone(s.intensity_pct ?? 0)}>{fmt1(s.intensity_pct)}</Ring>}
          label={t('kpi.level1', { rol: idealRol, sn: idealSn })}
          value={t('kpi.intensitySub', { n: s.activities.toLocaleString(), ideal: Math.round(s.ideal).toLocaleString() })}
        />
        <Kpi
          visual={<Ring value={Math.min(s.undertaken_pct ?? 0, 100)} color={rateTone(s.undertaken_pct ?? 0)}>{fmt1(s.undertaken_pct)}</Ring>}
          label={t('kpi.level2')}
          value={t('kpi.undertakenSub', { n: (s.undertaken_actual ?? 0).toLocaleString(), expected: (s.undertaken_expected ?? 0).toLocaleString() })}
        />
        <Kpi
          visual={<Ring value={Math.min(s.own_pct ?? 0, 100)} color={rateTone(s.own_pct ?? 0)}>{fmt1(s.own_pct)}</Ring>}
          label={t('kpi.level3')}
          value={t('kpi.ownSub', { n: s.own_actual.toLocaleString(), expected: s.own_expected.toLocaleString() })}
        />
      </KpiRow>
      <p className="-mt-2 text-sm text-ink-muted">{t('expected.levelsNote')}</p>

      {example && (
        <Section icon={<Calculator />} title={t('expected.workedTitle')} subtitle={t('expected.workedSub')}>
          {exampleText.length > 0 && (
            <div className="rounded-xl bg-surface-sunken p-4 text-sm leading-relaxed text-ink">
              <span className="font-semibold">{t('expected.exampleLead')}</span>{' '}
              {exampleText.join(' | ')}{' '}
              <span className="font-semibold">= {t('expected.exampleTotal', { n: example.expected.community.total })}</span>
            </div>
          )}
          {sameClock ? (
            namedBatches.length > 0 && <p className="mt-3 text-sm text-ink-muted">{t('expected.sameClock', { n: namedBatches.length })}</p>
          ) : (
            <>
              <h4 className="mb-1 mt-5 text-sm font-semibold text-ink">{t('expected.byBatch')}</h4>
              <p className="mb-2 text-sm text-ink-muted">{t('expected.byBatchSub')}</p>
              <DataTable>
                <thead>
                  <tr>
                    <Th className="text-left">{t('expected.batch')}</Th>
                    <Th>{t('expected.trainingEnded')}</Th>
                    <Th>{t('table.learners')}</Th>
                    <Th>{t('expected.fuByTranche')}</Th>
                    <Th>{t('expected.perLearner')}</Th>
                    <Th>{t('expected.nurse')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {cal.batches.map(b => (
                    <tr key={b.id ?? 'project'}>
                      <td className="px-3 py-2 font-medium text-ink">{b.name ?? t('expected.projectDate')}</td>
                      <td className="px-3 py-2 text-center text-ink-muted">{fmtDate(b.end_date)}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{b.learners}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{b.tranche_fu.join(' · ') || '—'}</td>
                      <td className="px-3 py-2 text-center font-bold tabular-nums">{b.expected.community.total}</td>
                      <td className="px-3 py-2 text-center tabular-nums text-ink-muted">{b.expected.nurse.total}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </>
          )}
        </Section>
      )}

      {uptake.length > 0 && (
        <Section icon={<Hourglass />} title={t('expected.uptakeTitle')} subtitle={t('expected.uptakeSub')}
          actions={<ChipRow label="" value={upGroup} onChange={v => setUpGroup(v as UptakeGroupKey)}
            items={(['all', 'rol', 'sn'] as UptakeGroupKey[]).map(k => ({ key: k, label: t(`expected.upGroup.${k}`) }))} />}>
          <DataTable>
            <thead>
              <tr>
                <Th className="text-left">{t('expected.trancheHead')}</Th>
                <Th>{t('table.learners')}</Th>
                <Th>{t('expected.started')}</Th>
                <Th title={t('expected.iqrTitle')}>{t('expected.medianStartIqr')}</Th>
                <Th>{t('expected.completed')}</Th>
                <Th title={t('expected.iqrTitle')}>{t('expected.medianCompleteIqr')}</Th>
              </tr>
            </thead>
            <tbody>
              {uptake.map(u => {
                const g = upOf(u);
                if (!g || !g.learners) return null;
                return (
                  <tr key={u.step}>
                    <td className="px-3 py-2">
                      <div className="whitespace-nowrap font-medium text-ink">{t('expected.tranche', { n: u.step })}</div>
                      <div className="whitespace-nowrap text-xs text-ink-faint">{u.from ? t('expected.openedOn', { date: fmtDate(u.from) }) : '—'}</div>
                      <div className="max-w-[15rem] text-xs text-ink-muted">{asked(u.added)}</div>
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">{g.learners}</td>
                    <RateCell value={g.started_pct} sub={`${g.started} / ${g.learners}`} />
                    <td className="px-3 py-2 text-center tabular-nums">{iqr(g.median_days_to_start, g.q1_days_to_start, g.q3_days_to_start, days)}</td>
                    <RateCell value={g.completed_pct} sub={`${g.completed} / ${g.learners}`} />
                    <td className="px-3 py-2 text-center tabular-nums">{iqr(g.median_days_to_complete, g.q1_days_to_complete, g.q3_days_to_complete, days)}</td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>

          <h4 className="mb-1 mt-6 text-sm font-semibold text-ink">{t('expected.nthTitle')}</h4>
          <p className="mb-3 text-sm text-ink-muted">{t('expected.nthSub')}</p>
          <div className="space-y-5">
            {uptake.map(u => {
              const g = upOf(u);
              if (!g || !g.nth.length) return null;
              return (
                <div key={u.step}>
                  <div className="mb-2 text-sm font-semibold text-ink">{t('expected.tranche', { n: u.step })}</div>
                  <div className="space-y-2">
                    {g.nth.map(n => (
                      <div key={n.n} className="grid grid-cols-1 gap-2 sm:grid-cols-[12rem_1fr] sm:items-center [&>*]:min-w-0">
                        <div className="text-sm">
                          <span className="font-medium text-ink">{t('expected.nthLabel', { n: n.n })}</span>
                          <div className="text-xs text-ink-muted">
                            {t('expected.nthDone', { done: n.done, of: n.learners })} · {iqr(n.median, n.q1, n.q3, days)}
                          </div>
                        </div>
                        <StackedBar height="h-5" showLegend={false}
                          parts={UPTAKE_BUCKETS.map(b => ({ key: b, label: t(`expected.bucket.${b}`), value: n.by[b], color: UPTAKE_COLORS[b] }))} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            {UPTAKE_BUCKETS.map(b => (
              <span key={b} className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                <span className="size-2.5 rounded-full" style={{ background: UPTAKE_COLORS[b] }} aria-hidden />{t(`expected.bucket.${b}`)}
              </span>
            ))}
          </div>
          <MasdFindings className="mt-5" findings={report.insights.uptake ?? []} />
        </Section>
      )}

      <Section icon={<Target />} title={t('expected.typeTitle')} subtitle={t('expected.typeSub')}>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-5 [&>*]:min-w-0">
          <div className="xl:col-span-3">
            <GroupedColumns
              categories={KINDS.map(k => ({ key: k, label: t(`expected.kind.${k}`),
                sub: t('expected.typeN', { adopted: kindOf(total, k).adopted, target: kindOf(total, k).target }) }))}
              series={typeSeries}
              reference={{ value: 100, label: t('activity.targetLine') }}
              references={averageLines(typeSeries, [total.fulfilment_pct, total.intensity_pct], x => t('activity.avgLine', { what: x.label }))}
              valueSuffix="%"
            />
          </div>
          <div className="xl:col-span-2">
            <MasdFindings findings={report.insights.by_type} />
          </div>
        </div>
      </Section>

      <Section
        icon={<ChartColumn />}
        title={t('expected.byGroupTitle', { type: t(`expected.kind.${kind}`), what: word })}
        subtitle={t('expected.byGroupSub')}
      >
        <div className="mb-4">
          <ChipRow label={t('expected.typeLabel')} value={kind} onChange={v => setKind(v as Kind)}
            items={KINDS.map(k => ({ key: k, label: t(`expected.kind.${k}`) }))} />
        </div>
        <GroupedColumns
          categories={groups.map(g => ({ key: g.key, label: g.label, sub: `n=${g.learners}` }))}
          series={groupSeries}
          reference={{ value: 100, label: t('activity.targetLine') }}
          references={averageLines(groupSeries, [kindOf(total, kind).adoption_pct, kindOf(total, kind).activity_pct], x => t('activity.avgLine', { what: x.label }))}
          valueSuffix="%"
        />
        {best && worst && best.key !== worst.key && (
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-success-50 px-3 py-1 font-medium text-success-600 dark:bg-success-500/15">
              {t('expected.best', { name: best.label, pct: fmt1(kindOf(best, kind).activity_pct) })}
            </span>
            <span className="rounded-full bg-error-50 px-3 py-1 font-medium text-error-600 dark:bg-error-500/15">
              {t('expected.worst', { name: worst.label, pct: fmt1(kindOf(worst, kind).activity_pct) })}
            </span>
          </div>
        )}
        <h4 className="mb-2 mt-6 flex items-center gap-2 text-sm font-semibold text-ink"><ChartScatter className="size-4" />{t('expected.bubbleTitle')}</h4>
        <BubblePlot
          bubbles={groups.filter(g => kindOf(g, kind).adoption_pct != null && kindOf(g, kind).activity_pct != null).map(g => ({
            key: g.key, label: g.label, x: kindOf(g, kind).adoption_pct!, y: kindOf(g, kind).activity_pct!, size: g.learners,
          }))}
          xLabel={t('activity.bubbleX')}
          yLabel={t('activity.bubbleY')}
          quadrant={{
            topRight: t('activity.qTopRight'), topLeft: t('activity.qTopLeft'),
            bottomRight: t('activity.qBottomRight'), bottomLeft: t('activity.qBottomLeft'),
          }}
          sizeLabel={n => t('activity.learnersN', { count: n })}
        />
        <DataTable className="mt-5">
          <thead>
            <tr>
              <Th className="text-left">{word}</Th>
              <Th>{t('table.learners')}</Th>
              <Th title={t('expected.adopted')}>{t('table.fulfilment')}</Th>
              <Th title={t('expected.done')}>{t('table.intensity')}</Th>
            </tr>
          </thead>
          <tbody>
            {[...groups, total].map(g => {
              const v = kindOf(g, kind);
              return (
                <tr key={g.key} className={g === total ? 'bg-surface-sunken/50 font-semibold' : undefined}>
                  <td className="px-3 py-2 font-medium text-ink">
                    {g.label}
                    {g.key === best?.key && <span className="ml-1 text-success-600">▲</span>}
                    {g.key === worst?.key && <span className="ml-1 text-error-600">▼</span>}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums text-ink-muted">{g.learners}</td>
                  <RateCell value={v.adoption_pct} sub={`${v.adopted} / ${v.target}`} />
                  <RateCell value={v.activity_pct} sub={`${v.actual.toLocaleString()} / ${v.expected.toLocaleString()}`} />
                </tr>
              );
            })}
          </tbody>
        </DataTable>
        <RateLegend className="mt-3" />
      </Section>

      <Section icon={<Layers3 />} title={t('expected.ownTitle')} subtitle={t('expected.ownSub')}>
        <ChipRow label={t('split.label')} value={bandSplit} onChange={v => setBandSplit(v as BandSplit)}
          items={(['departments', 'blocks', 'roles'] as BandSplit[]).map(k => ({ key: k, label: t(`expected.split.${k}`) }))} />
        <div className="mt-5 space-y-4">
          {[...bandGroups, ...(bandSplit === 'departments' ? [] : [{ ...s, key: 'total', label: t('table.total') } as MasdGroup])].map(g => (
            <div key={g.key} className="grid grid-cols-1 gap-2 sm:grid-cols-[11rem_1fr] sm:items-center [&>*]:min-w-0">
              <div className="text-sm">
                <span className="font-semibold text-ink">{g.label.replace(' subtotal', '')}</span>
                <span className="ml-1.5 text-xs text-ink-faint">{t('expected.ownN', { n: g.own_banded, pct: fmt1(g.own_pct) })}</span>
              </div>
              <StackedBar
                height="h-6"
                showLegend={false}
                parts={OWN_BANDS.map(b => ({ key: b, label: t(`bandsOwn.${b}`), value: g.own_bands[b], color: BAND_COLORS[b] }))}
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
          {OWN_BANDS.map(b => (
            <span key={b} className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
              <span className="size-2.5 rounded-full" style={{ background: BAND_COLORS[b] }} aria-hidden />{t(`bandsOwn.${b}`)}
            </span>
          ))}
        </div>
        <DataTable className="mt-5">
          <thead>
            <tr>
              <Th className="text-left">{t(`expected.split.${bandSplit}One`)}</Th>
              <Th>{t('expected.banded')}</Th>
              {OWN_BANDS.map(b => <Th key={b}>{t(`bandsOwn.${b}`)}</Th>)}
              <Th>{t('expected.ownPct')}</Th>
            </tr>
          </thead>
          <tbody>
            {bandGroups.map(g => (
              <tr key={g.key}>
                <td className="px-3 py-2 font-medium text-ink">{g.label.replace(' subtotal', '')}</td>
                <td className="px-3 py-2 text-center tabular-nums">{g.own_banded}</td>
                {OWN_BANDS.map(b => (
                  <td key={b} className="px-3 py-2 text-center tabular-nums">
                    {g.own_banded ? `${Math.round((100 * g.own_bands[b]) / g.own_banded)}%` : '—'}
                    <span className="ml-1 text-xs text-ink-faint">({g.own_bands[b]})</span>
                  </td>
                ))}
                <RateCell value={g.own_pct} />
              </tr>
            ))}
            <tr className="bg-surface-sunken/50 font-semibold">
              <td className="px-3 py-2 text-ink">{t('table.total')}</td>
              <td className="px-3 py-2 text-center tabular-nums">{s.own_banded}</td>
              {OWN_BANDS.map(b => (
                <td key={b} className="px-3 py-2 text-center tabular-nums">
                  {s.own_banded ? `${Math.round((100 * s.own_bands[b]) / s.own_banded)}%` : '—'}
                  <span className="ml-1 text-xs font-normal text-ink-faint">({s.own_bands[b]})</span>
                </td>
              ))}
              <RateCell value={s.own_pct} />
            </tr>
          </tbody>
        </DataTable>
        <MasdFindings className="mt-5" findings={report.insights.own_cases} />
      </Section>

      <Section icon={<ListChecks />} title={t('expected.howTitle')}>
        <ul className="space-y-1.5 text-sm text-ink-muted">
          <li className="flex gap-2"><Timer className="mt-0.5 size-4 shrink-0 text-ink-faint" />{t('expected.how1', {
            first: report.rules.expected.buffer_days, later: report.rules.expected.later_buffer_days, step: cal.step_days,
          })}</li>
          <li className="flex gap-2"><Target className="mt-0.5 size-4 shrink-0 text-ink-faint" />{t('expected.how2')}</li>
          <li className="flex gap-2"><Layers3 className="mt-0.5 size-4 shrink-0 text-ink-faint" />{t('expected.how3')}</li>
        </ul>
      </Section>
    </div>
  );
};

export default MasdExpected;
