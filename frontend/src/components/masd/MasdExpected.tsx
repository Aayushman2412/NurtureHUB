import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calculator, ChartColumn, ChartScatter, Hourglass, Layers3, ListChecks, Target, Timer } from 'lucide-react';
import {
  ACTIVITY_KEYS, ADOPTION_TYPES, OWN_BANDS, UPTAKE_BUCKETS,
  type AdoptionType, type MasdGroup, type MasdReport, type OwnBand, type Targets, type UptakeBucket,
} from '../../api/masd';
import { BigNumber, ChipRow, Kpi, KpiRow, Section } from '../results/InsightParts';
import { Ring, StackedBar } from '../results/InsightCharts';
import MasdFindings from './MasdFindings';
import { BubblePlot, DataTable, GroupedColumns, RateCell, Th } from './MasdCharts';
import { fmt1, MASD_COLORS, rateTone } from '../../lib/masdDisplay';

type Split = 'blocks' | 'departments' | 'roles';
const MIN_FOR_RANK = 3;

const BAND_COLORS: Record<OwnBand, string> = {
  none: '#8E3B2F', b1_20: '#D6453D', b21_40: '#E0A11B', b41_60: '#C9B458', b61_80: '#7FB069', b81_100: '#2F9E56',
};
// When the first adoption for a tranche came: early is good, never is the worry.
const UPTAKE_COLORS: Record<UptakeBucket, string> = {
  before: '#2A7F8F', d7: '#2F9E56', d15: '#7FB069', d30: '#E0A11B', later: '#D6453D', not_yet: '#A8A29E',
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });

/**
 * Expected activity — the method agreed on 29 Sep 2026, counted tranche by
 * tranche since 1–3 Oct. A learner is read against what was EXPECTED of them by
 * the report date: the targets come in tranches, each followed up from the day
 * it opened (or the learner's batch ended, if later) plus a buffer, rounded
 * down to 15 days; the forms expected are, per tranche, the adoptions it asked
 * for × the expected-forms table at that tranche's follow-up. Then: how
 * quickly was each tranche taken up, and within the cases they did adopt, how
 * much of what those cases were due have they done?
 */
const MasdExpected: React.FC<{ report: MasdReport }> = ({ report }) => {
  const { t } = useTranslation('masd');
  const s = report.summary;
  const cal = report.calendar;
  const tn = cal.targets.now;
  const [split, setSplit] = useState<Split>('blocks');
  const [atype, setAtype] = useState<AdoptionType>('pnc_lt5');
  const [bandSplit, setBandSplit] = useState<Split>('departments');

  const groupsFor = (key: Split): MasdGroup[] =>
    (key === 'departments' ? report.departments.filter(g => g.key !== 'total') : report[key]).filter(g => g.learners > 0);
  const groups = groupsFor(split);
  const word = t(`expected.split.${split}One`);

  const ranked = groups.filter(g => g.learners >= MIN_FOR_RANK && g.by_type[atype].activity_pct != null);
  const best = ranked.length >= 2 ? ranked.reduce((a, b) => (b.by_type[atype].activity_pct! > a.by_type[atype].activity_pct! ? b : a)) : null;
  const worst = ranked.length >= 2 ? ranked.reduce((a, b) => (b.by_type[atype].activity_pct! < a.by_type[atype].activity_pct! ? b : a)) : null;

  const example = cal.batches[0];
  const tranches = useMemo(() => example?.expected.tranches ?? [], [example]);
  const sameClock = new Set(cal.batches.map(b => b.tranche_fu.join(','))).size <= 1;
  const namedBatches = cal.batches.filter(b => b.id != null);
  const asked = (a: Targets) => {
    const parts = ADOPTION_TYPES.filter(k => a[k]).map(k => `+${a[k]} ${t(`settings.target.${k}`)}`);
    if (a.nurse) parts.push(t('expected.askedNurse', { n: a.nurse }));
    return parts.join(' · ') || '—';
  };
  const trancheCell = (step: number, opened: string | null, buffer: number | null, added: Targets) => (
    <td className="px-3 py-2">
      <div className="whitespace-nowrap font-medium text-ink">{t('expected.tranche', { n: step })}</div>
      <div className="whitespace-nowrap text-xs text-ink-faint">
        {opened ? (buffer != null ? t('expected.openedBuffer', { date: fmtDate(opened), n: buffer }) : t('expected.openedOn', { date: fmtDate(opened) })) : '—'}
      </div>
      <div className="max-w-[15rem] text-xs text-ink-muted">{asked(added)}</div>
    </td>
  );
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
  const fuList = cal.tranches.map(tr => tr.fu_days ?? 0).join(' · ');

  const bandGroups = groupsFor(bandSplit).filter(g => g.own_banded > 0);

  return (
    <div className="space-y-5">
      <KpiRow count={4}>
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
          visual={<Ring value={Math.min(s.own_pct ?? 0, 100)} color={rateTone(s.own_pct ?? 0)}>{fmt1(s.own_pct)}</Ring>}
          label={t('kpi.own')}
          value={t('kpi.ownSub', { n: s.own_actual.toLocaleString(), expected: s.own_expected.toLocaleString() })}
        />
        <Kpi
          visual={<BigNumber value={cal.tranches.length ? cal.tranches.length : '—'} />}
          label={t('kpi.fu')}
          value={t('kpi.fuSub', { days: fuList || '—', step: cal.step_days })}
        />
      </KpiRow>

      <Section icon={<Calculator />} title={t('expected.nowTitle')}
        subtitle={t('expected.nowSub', { date: fmtDate(report.as_of), anc: tn.anc, lt5: tn.pnc_lt5, ge5: tn.pnc_ge5, nurse: tn.nurse })}>
        {!example ? (
          <p className="text-sm text-ink-muted">{t('expected.noBatches')}</p>
        ) : (
          <>
            <DataTable>
              <thead>
                <tr>
                  <Th className="text-left">{t('expected.trancheHead')}</Th>
                  <Th title={t('expected.fuTitle')}>{t('expected.fu')}</Th>
                  {ACTIVITY_KEYS.map(k => <Th key={k} title={t(`activities.${k}`)}>{t(`expected.short.${k}`)}</Th>)}
                  <Th>{t('expected.perLearner')}</Th>
                  <Th>{t('expected.nurse')}</Th>
                </tr>
              </thead>
              <tbody>
                {tranches.map(tr => (
                  <tr key={tr.step}>
                    {trancheCell(tr.step, tr.opened, tr.buffer, tr.added)}
                    <td className="px-3 py-2 text-center tabular-nums">
                      {tr.fu_raw ?? '—'} <span className="text-xs text-ink-faint">→ {tr.fu_days ?? 0}</span>
                    </td>
                    {ACTIVITY_KEYS.map(k => (
                      <td key={k} className="px-3 py-2 text-center tabular-nums">{tr.community.forms[k] || ''}</td>
                    ))}
                    <td className="px-3 py-2 text-center font-bold tabular-nums">{tr.community.total}</td>
                    <td className="px-3 py-2 text-center tabular-nums text-ink-muted">{tr.nurse.total}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border-strong bg-surface-sunken/60">
                  <td className="px-3 py-2 font-semibold text-ink" colSpan={2}>{t('expected.allTranches')}</td>
                  {ACTIVITY_KEYS.map(k => (
                    <td key={k} className="px-3 py-2 text-center font-semibold tabular-nums">{example.expected.community.forms[k] || ''}</td>
                  ))}
                  <td className="px-3 py-2 text-center font-bold tabular-nums">{example.expected.community.total}</td>
                  <td className="px-3 py-2 text-center font-semibold tabular-nums text-ink-muted">{example.expected.nurse.total}</td>
                </tr>
              </tbody>
            </DataTable>
            {exampleText.length > 0 && (
              <div className="mt-4 rounded-xl bg-surface-sunken p-4 text-sm text-ink">
                <span className="font-semibold">{t('expected.exampleLead')}</span>{' '}
                {exampleText.join(' | ')}{' '}
                <span className="font-semibold">= {t('expected.exampleTotal', { n: example.expected.community.total })}</span>
              </div>
            )}
            {sameClock ? (
              namedBatches.length > 0 && <p className="mt-3 text-xs text-ink-muted">{t('expected.sameClock', { n: namedBatches.length })}</p>
            ) : (
              <>
                <h4 className="mb-1 mt-5 text-sm font-semibold text-ink">{t('expected.byBatch')}</h4>
                <p className="mb-2 text-xs text-ink-muted">{t('expected.byBatchSub')}</p>
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
          </>
        )}
      </Section>

      {uptake.length > 0 && (
        <Section icon={<Hourglass />} title={t('expected.uptakeTitle')} subtitle={t('expected.uptakeSub')}>
          <DataTable>
                <thead>
                  <tr>
                    <Th className="text-left">{t('expected.trancheHead')}</Th>
                    <Th>{t('table.learners')}</Th>
                    <Th>{t('expected.started')}</Th>
                    <Th>{t('expected.medianStart')}</Th>
                    <Th>{t('expected.completed')}</Th>
                    <Th>{t('expected.medianComplete')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {uptake.map(u => (
                    <tr key={u.step}>
                      {trancheCell(u.step, u.from, null, u.added)}
                      <td className="px-3 py-2 text-center tabular-nums">{u.learners}</td>
                      <RateCell value={u.started_pct} sub={`${u.started} / ${u.learners}`} />
                      <td className="px-3 py-2 text-center tabular-nums">{u.median_days_to_start == null ? '—' : t('expected.daysN', { n: u.median_days_to_start })}</td>
                      <RateCell value={u.completed_pct} sub={`${u.completed} / ${u.learners}`} />
                      <td className="px-3 py-2 text-center tabular-nums">{u.median_days_to_complete == null ? '—' : t('expected.daysN', { n: u.median_days_to_complete })}</td>
                    </tr>
                  ))}
                </tbody>
          </DataTable>
          <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-5 [&>*]:min-w-0">
            <div className="xl:col-span-3">
              <h4 className="mb-2 text-sm font-semibold text-ink">{t('expected.firstAdoption')}</h4>
              <div className="space-y-3">
                {uptake.map(u => (
                  <div key={u.step} className="grid grid-cols-1 gap-2 sm:grid-cols-[7rem_1fr] sm:items-center [&>*]:min-w-0">
                    <span className="text-sm font-semibold text-ink">{t('expected.tranche', { n: u.step })}</span>
                    <StackedBar
                      height="h-6"
                      showLegend={false}
                      parts={UPTAKE_BUCKETS.map(b => ({ key: b, label: t(`expected.bucket.${b}`), value: u.started_by[b], color: UPTAKE_COLORS[b] }))}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                {UPTAKE_BUCKETS.map(b => (
                  <span key={b} className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                    <span className="size-2.5 rounded-full" style={{ background: UPTAKE_COLORS[b] }} aria-hidden />{t(`expected.bucket.${b}`)}
                  </span>
                ))}
              </div>
            </div>
            <div className="xl:col-span-2">
              <MasdFindings findings={report.insights.uptake ?? []} />
            </div>
          </div>
        </Section>
      )}

      <Section icon={<Target />} title={t('expected.typeTitle')} subtitle={t('expected.typeSub')}>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-5 [&>*]:min-w-0">
          <div className="xl:col-span-3">
            <GroupedColumns
              categories={ADOPTION_TYPES.map(k => ({ key: k, label: t(`types.${k}`),
                sub: t('expected.typeN', { adopted: s.by_type[k].adopted, target: s.by_type[k].target }) }))}
              series={[
                { key: 'adopt', label: t('activity.adoptionPct'), color: MASD_COLORS.adoption, values: ADOPTION_TYPES.map(k => s.by_type[k].adoption_pct) },
                { key: 'act', label: t('activity.activityPct'), color: MASD_COLORS.activity, values: ADOPTION_TYPES.map(k => s.by_type[k].activity_pct) },
              ]}
              reference={{ value: 100, label: t('activity.targetLine') }}
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
        title={t('expected.byGroupTitle', { type: t(`types.${atype}`), what: word })}
        subtitle={t('expected.byGroupSub')}
      >
        <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2">
          <ChipRow label={t('expected.typeLabel')} value={atype} onChange={v => setAtype(v as AdoptionType)}
            items={ADOPTION_TYPES.map(k => ({ key: k, label: t(`types.${k}`) }))} />
          <ChipRow label={t('split.label')} value={split} onChange={v => setSplit(v as Split)}
            items={(['blocks', 'departments', 'roles'] as Split[]).map(k => ({ key: k, label: t(`expected.split.${k}`) }))} />
        </div>
        <GroupedColumns
          categories={groups.map(g => ({ key: g.key, label: g.label.replace(' subtotal', ''), sub: `n=${g.learners}` }))}
          series={[
            { key: 'adopt', label: t('activity.adoptionPct'), color: MASD_COLORS.adoption, values: groups.map(g => g.by_type[atype].adoption_pct) },
            { key: 'act', label: t('activity.activityPct'), color: MASD_COLORS.activity, values: groups.map(g => g.by_type[atype].activity_pct) },
          ]}
          reference={{ value: 100, label: t('activity.targetLine') }}
          valueSuffix="%"
        />
        {best && worst && best.key !== worst.key && (
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-success-50 px-3 py-1 font-medium text-success-600 dark:bg-success-500/15">
              {t('expected.best', { name: best.label.replace(' subtotal', ''), pct: fmt1(best.by_type[atype].activity_pct) })}
            </span>
            <span className="rounded-full bg-error-50 px-3 py-1 font-medium text-error-600 dark:bg-error-500/15">
              {t('expected.worst', { name: worst.label.replace(' subtotal', ''), pct: fmt1(worst.by_type[atype].activity_pct) })}
            </span>
          </div>
        )}
        <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-5 [&>*]:min-w-0">
          <div className="xl:col-span-3">
            <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink"><ChartScatter className="size-4" />{t('expected.bubbleTitle')}</h4>
            <BubblePlot
              bubbles={groups.filter(g => g.by_type[atype].adoption_pct != null && g.by_type[atype].activity_pct != null).map(g => ({
                key: g.key, label: g.label.replace(' subtotal', ''), x: g.by_type[atype].adoption_pct!, y: g.by_type[atype].activity_pct!, size: g.learners,
              }))}
              xLabel={t('activity.bubbleX')}
              yLabel={t('activity.bubbleY')}
              quadrant={{
                topRight: t('activity.qTopRight'), topLeft: t('activity.qTopLeft'),
                bottomRight: t('activity.qBottomRight'), bottomLeft: t('activity.qBottomLeft'),
              }}
              sizeLabel={n => t('activity.learnersN', { count: n })}
            />
          </div>
          <div className="xl:col-span-2">
            <DataTable>
              <thead>
                <tr>
                  <Th className="text-left">{word}</Th>
                  <Th title={t('expected.adopted')}>{t('table.fulfilment')}</Th>
                  <Th title={t('expected.done')}>{t('table.intensity')}</Th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => {
                  const v = g.by_type[atype];
                  return (
                    <tr key={g.key}>
                      <td className="px-3 py-2 font-medium text-ink">
                        {g.label.replace(' subtotal', '')}
                        {g.key === best?.key && <span className="ml-1 text-success-600">▲</span>}
                        {g.key === worst?.key && <span className="ml-1 text-error-600">▼</span>}
                      </td>
                      <RateCell value={v.adoption_pct} sub={`${v.adopted} / ${v.target}`} />
                      <RateCell value={v.activity_pct} sub={`${v.actual.toLocaleString()} / ${v.expected.toLocaleString()}`} />
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          </div>
        </div>
      </Section>

      <Section icon={<Layers3 />} title={t('expected.ownTitle')} subtitle={t('expected.ownSub')}>
        <ChipRow label={t('split.label')} value={bandSplit} onChange={v => setBandSplit(v as Split)}
          items={(['departments', 'blocks', 'roles'] as Split[]).map(k => ({ key: k, label: t(`expected.split.${k}`) }))} />
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
