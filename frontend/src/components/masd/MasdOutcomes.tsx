import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Baby, ClipboardCheck, Filter, HeartPulse, Milestone, Table2, TrendingDown, UserCheck, Users, Wrench } from 'lucide-react';
import {
  MAIN_INDICATORS, SEVERE_INDICATORS,
  type Band, type Benchmarks, type BenchValues, type Indicator, type MasdReport, type Prevalence,
} from '../../api/masd';
import { ChipRow, Section } from '../results/InsightParts';
import { BarList } from '../results/InsightCharts';
import MasdFindings from './MasdFindings';
import { DataTable, GroupedColumns, GroupTh, RateCell, Th } from './MasdCharts';
import { fmt1, MASD_COLORS } from '../../lib/masdDisplay';
import { applyFilters, outcomeLearners, outcomeSplit, pct } from '../../lib/masdSplit';
import type { MasdSplitState } from './MasdSplitBar';
import { cn } from '../../utils/cn';

const BANDS: Band[] = ['lt6', 'm6_11'];
/** Birth, adoption and last visit, always in this order and these colours
 *  (review of 7 Oct 2026): blue, orange, green. */
const VISIT_COLORS = { bv: '#3B6EA8', av: '#E8892B', lv: '#2F9E56' } as const;
type Visit = keyof typeof VISIT_COLORS;

const signed = (v: number | null | undefined, unit = '') => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}${unit}`);

/** The district under-5 rounds: the latest and the one before, from the trend
 *  the analysts entered (or the single under-5 column if that is all there is). */
function districtRounds(bench: Benchmarks | null) {
  const tr = bench?.district_trend;
  if (tr?.rounds?.length) {
    const n = tr.rounds.length;
    const pick = (k: number) => (k < 0 ? null : {
      label: tr.rounds[k],
      v: { stunting: tr.stunting[k] ?? null, underweight: tr.underweight[k] ?? null, wasting: tr.wasting[k] ?? null } as BenchValues,
    });
    return { latest: pick(n - 1), previous: pick(n - 2) };
  }
  return { latest: bench?.under5 ? { label: bench.label, v: bench.under5 } : null, previous: null };
}

const NfhsCell: React.FC<{ v: number | null | undefined }> = ({ v }) => (
  <td className="px-3 py-2 text-center tabular-nums text-ink">{fmt1(v ?? null)}</td>
);

/**
 * One prevalence table, as Rupal ma'am presents it: NFHS indicators first
 * (district under-5 latest and previous round with the change, state <6 and
 * 6–11 months), then the project's own outcomes (birth, adoption and last
 * visit, the change and the relative change), n in the heading.
 */
const PrevTable: React.FC<{ p: Prevalence; rows: Indicator[]; bench: Benchmarks | null; showBv: boolean; nLabel: string }> = ({
  p, rows, bench, showBv, nLabel,
}) => {
  const { t } = useTranslation('masd');
  const ages = bench?.age_bands ?? {};
  const { latest, previous } = districtRounds(bench);
  const has = (vals: (number | null | undefined)[]) => vals.some(v => v != null);
  const showLatest = !!latest && has(rows.map(i => latest.v[i]));
  const showPrev = !!previous && has(rows.map(i => previous.v[i]));
  const showChange = showLatest && showPrev;
  const showBands = BANDS.filter(b => has(rows.map(i => ages[b]?.[i])));
  const nfhsCols = (showLatest ? 1 : 0) + (showPrev ? 1 : 0) + (showChange ? 1 : 0) + showBands.length;
  const projCols = (showBv ? 1 : 0) + 4;
  return (
    <DataTable>
      <thead>
        <tr>
          <Th className="text-left" />
          {nfhsCols > 0 && <GroupTh span={nfhsCols}>{t('outcomes.nfhsGroup')}</GroupTh>}
          <GroupTh span={projCols}>{t('outcomes.projectGroup', { n: nLabel })}</GroupTh>
        </tr>
        <tr>
          <Th className="text-left">{t('outcomes.indicator')}</Th>
          {showLatest && <Th className="border-l-2 border-border-strong" title={bench?.district_trend?.label ?? bench?.label}>{t('outcomes.districtU5', { round: latest!.label })}</Th>}
          {showPrev && <Th title={bench?.district_trend?.label}>{t('outcomes.districtU5', { round: previous!.label })}</Th>}
          {showChange && <Th>{t('outcomes.nfhsChange')}</Th>}
          {showBands.map((b, k) => (
            <Th key={b} className={!showLatest && k === 0 ? 'border-l-2 border-border-strong' : undefined} title={bench?.label}>
              {t('outcomes.stateBand', { band: t(`bands.${b}`) })}
            </Th>
          ))}
          {showBv && <Th className="border-l-2 border-border-strong" title={t('outcomes.bvFull')}>BV</Th>}
          <Th className={showBv ? undefined : 'border-l-2 border-border-strong'} title={t('outcomes.avFull')}>AV</Th>
          <Th title={t('outcomes.lvFull')}>LV</Th>
          <Th>{t('outcomes.absChange')}</Th>
          <Th>{t('outcomes.relChange')}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.filter(i => p[i]).map(i => {
          const x = p[i];
          const a = latest?.v[i] ?? null, b = previous?.v[i] ?? null;
          const abs = a != null && b != null ? a - b : null;
          const rel = a != null && b ? (100 * (a - b)) / b : null;
          return (
            <tr key={i}>
              <td className="px-3 py-2 font-medium text-ink">{t(`indicators.${i}`)}</td>
              {showLatest && <NfhsCell v={a} />}
              {showPrev && <NfhsCell v={b} />}
              {showChange && (
                <td className="px-3 py-2 text-center tabular-nums text-ink">
                  {abs == null ? '—' : <>{signed(abs, ` ${t('outcomes.pts')}`)} <span className="text-xs text-ink-muted">({signed(rel, '%')})</span></>}
                </td>
              )}
              {showBands.map(band => <NfhsCell key={band} v={ages[band]?.[i]} />)}
              {showBv && <RateCell value={x.bv} lowerIsBetter sub={`n=${x.n_bv}`} />}
              <RateCell value={x.av} lowerIsBetter sub={`n=${x.n_av}`} />
              <RateCell value={x.lv} lowerIsBetter sub={`n=${x.n_lv}`} />
              <td className="px-3 py-2 text-center tabular-nums">{signed(x.abs_change, ` ${t('outcomes.pts')}`)}</td>
              <td className="px-3 py-2 text-center tabular-nums">{signed(x.rel_change, '%')}</td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
};

const visitSeries = (p: Prevalence, inds: Indicator[], showBv: boolean, t: (k: string) => string) =>
  (['bv', 'av', 'lv'] as Visit[]).filter(v => showBv || v !== 'bv').map(v => ({
    key: v, label: t(`outcomes.${v}Full`), color: VISIT_COLORS[v], values: inds.map(i => (p.n ? p[i][v] : null)),
  }));

type Who = 'overall' | 'mtfl' | 'other';

const MasdOutcomes: React.FC<{ report: MasdReport; split: MasdSplitState }> = ({ report, split }) => {
  const { t } = useTranslation('masd');
  const o = report.outcomes;
  const ex = o.exclusions;
  const [who, setWho] = useState<Who>('overall');
  const [showBv, setShowBv] = useState(false);
  const prev = o.prevalence[who];
  const bench = o.benchmarks;
  const funnelLabel: Record<string, string> = {
    start: t('outcomes.funnelStart'), no_f2f: t('outcomes.funnelNoBatch'), nursing_staff: t('outcomes.funnelNurses'),
  };
  const word = t(`splitDims.${split.dim}`);
  const outcomeRows = useMemo(() => applyFilters(outcomeLearners(report), split.filters), [report, split.filters]);
  const groups = useMemo(() => outcomeSplit(outcomeRows, o, split.dim), [outcomeRows, o, split.dim]);
  const reasons = ex.reasons.filter(r => groups.some(g => g.reasons[r.key]));
  const cmp = report.comparison;

  const bvToggle = (
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-ink">
      <input type="checkbox" className="size-4 accent-(--primary)" checked={showBv} onChange={e => setShowBv(e.target.checked)} />
      {t('outcomes.showBv')}
    </label>
  );

  return (
    <div className="space-y-5">
      <Section icon={<Filter />} title={t('outcomes.funnelTitle')} subtitle={t('outcomes.funnelSub')}>
        <DataTable>
          <thead>
            <tr>
              <Th className="text-left">{t('outcomes.step')}</Th>
              <Th>{t('outcomes.learnersOut')}</Th>
              <Th>{t('outcomes.learnersLeft')}</Th>
              <Th>{t('outcomes.casesOut')}</Th>
              <Th>{t('outcomes.casesLeft')}</Th>
            </tr>
          </thead>
          <tbody>
            {o.funnel.map(s => (
              <tr key={s.key}>
                <td className="px-3 py-2 text-ink">{funnelLabel[s.key] ?? s.key}</td>
                <td className="px-3 py-2 text-center tabular-nums text-error-600">{s.learners_removed ? `−${s.learners_removed}` : ''}</td>
                <td className="px-3 py-2 text-center font-semibold tabular-nums">{s.learners_after}</td>
                <td className="px-3 py-2 text-center tabular-nums text-error-600">{s.cases_removed ? `−${s.cases_removed}` : ''}</td>
                <td className="px-3 py-2 text-center font-semibold tabular-nums">{s.cases_after.toLocaleString()}</td>
              </tr>
            ))}
            <tr className="bg-surface-sunken/50 font-semibold">
              <td className="px-3 py-2 text-ink">{t('outcomes.funnelFinal')}</td>
              <td /><td className="px-3 py-2 text-center">{ex.total.total ? o.funnel[o.funnel.length - 1].learners_after : 0}</td>
              <td /><td className="px-3 py-2 text-center">{ex.total.total.toLocaleString()}</td>
            </tr>
          </tbody>
        </DataTable>
        <MasdFindings className="mt-5" findings={report.insights.outcomes} />
      </Section>

      <Section icon={<ClipboardCheck />} title={t('outcomes.exclTitleBy', { what: word })} subtitle={t('outcomes.exclSub')}>
        <DataTable>
          <thead>
            <tr>
              <Th className="text-left">{t('outcomes.reason')}</Th>
              {groups.map(g => <Th key={g.key}>{g.key === 'Total' ? t('table.total') : g.label}</Th>)}
            </tr>
          </thead>
          <tbody>
            {reasons.map(r => (
              <tr key={r.key}>
                <td className="px-3 py-1.5 text-xs text-ink sm:text-sm">{t(`reasons.${r.key}`, { defaultValue: r.label })}</td>
                {groups.map(g => (
                  <td key={g.key} className={cn('px-3 py-1.5 text-center tabular-nums', g.key === 'Total' && 'font-semibold')}>
                    {g.reasons[r.key] ?? 0}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="bg-success-50/60 font-semibold dark:bg-success-500/10">
              <td className="px-3 py-2">{t('outcomes.included')}</td>
              {groups.map(g => (
                <td key={g.key} className="px-3 py-2 text-center">{g.included.toLocaleString()} <span className="text-xs font-normal">({fmt1(pct(g.included, g.eligible))})</span></td>
              ))}
            </tr>
            <tr className="font-semibold">
              <td className="px-3 py-2">{t('outcomes.eligibleTotal')}</td>
              {groups.map(g => <td key={g.key} className="px-3 py-2 text-center">{g.eligible.toLocaleString()}</td>)}
            </tr>
            <tr>
              <td className="px-3 py-2 text-xs text-ink-muted">{t('outcomes.learnersN')}</td>
              {groups.map(g => <td key={g.key} className="px-3 py-2 text-center text-xs text-ink-muted">n={g.learners}</td>)}
            </tr>
          </tbody>
        </DataTable>
        <p className="mt-2 text-xs text-ink-muted">{t('outcomes.exclNote')}</p>
      </Section>

      <Section icon={<UserCheck />} title={t('outcomes.retentionTitleBy', { what: word })} subtitle={t('outcomes.retentionSub')}>
        <DataTable>
          <thead>
            <tr>
              <Th className="text-left">{word}</Th>
              <Th>{t('outcomes.ret_learners')}</Th>
              <Th>{t('outcomes.inFinal')}</Th>
              <Th>{t('outcomes.retained')}</Th>
              <Th className="border-l-2 border-border-strong">{t('outcomes.ret_adoptions')}</Th>
              <Th>{t('outcomes.inFinal')}</Th>
              <Th>{t('outcomes.retained')}</Th>
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <tr key={g.key} className={g.key === 'Total' ? 'bg-surface-sunken/50 font-semibold' : undefined}>
                <td className="px-3 py-2">{g.key === 'Total' ? t('table.total') : g.label}</td>
                <td className="px-3 py-2 text-center tabular-nums">{g.learners}</td>
                <td className="px-3 py-2 text-center tabular-nums">{g.learnersFinal}</td>
                <RateCell value={pct(g.learnersFinal, g.learners)} />
                <td className="border-l-2 border-border-strong px-3 py-2 text-center tabular-nums">{g.eligible.toLocaleString()}</td>
                <td className="px-3 py-2 text-center tabular-nums">{g.included.toLocaleString()}</td>
                <RateCell value={pct(g.included, g.eligible)} />
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Section>

      <Section icon={<Users />} title={t('outcomes.demoTitle', { n: o.demographics.n.toLocaleString() })} subtitle={t('outcomes.demoSub')}>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
          {(['mother_age', 'education', 'social_category', 'ration_card', 'delivery_place', 'delivery_method'] as const).map(key => {
            const rows = o.demographics[key] ?? [];
            if (!rows.length) return null;
            return (
              <div key={key}>
                <h4 className="mb-3 text-sm font-semibold text-ink">{t(`demo.${key}`)}</h4>
                <BarList
                  max={100}
                  rows={rows.filter(x => x.n > 0).map(x => ({
                    key: x.label, label: x.label, value: x.pct ?? 0, display: fmt1(x.pct), sub: `n=${x.n}`, color: MASD_COLORS.activity,
                  }))}
                />
              </div>
            );
          })}
        </div>
        <PlaceByMethod report={report} />
        <p className="mt-3 text-xs text-ink-muted">{t('outcomes.familyTypeNote')}</p>
      </Section>

      <Section
        icon={<HeartPulse />}
        title={t('outcomes.prevTitle')}
        subtitle={t('outcomes.prevSub')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {bvToggle}
            <ChipRow label="" value={who} onChange={v => setWho(v as Who)}
              items={[{ key: 'overall', label: t('outcomes.overall') }, { key: 'mtfl', label: 'MT+FL' }, { key: 'other', label: t('outcomes.otherLearners') }]} />
          </div>
        }
      >
        {prev.n ? (
          <>
            <PrevTable p={prev} rows={MAIN_INDICATORS} bench={bench} showBv={showBv} nLabel={prev.n.toLocaleString()} />
            <div className="mt-5">
              <GroupedColumns
                categories={MAIN_INDICATORS.map(i => ({ key: i, label: t(`indicators.${i}`) }))}
                series={visitSeries(prev, MAIN_INDICATORS, showBv, t)}
                height={210}
                valueSuffix="%"
              />
            </div>
            <h4 className="mb-2 mt-6 text-sm font-semibold text-ink">{t('outcomes.severeTitle')}</h4>
            <PrevTable p={prev} rows={SEVERE_INDICATORS} bench={bench} showBv={showBv} nLabel={prev.n.toLocaleString()} />
            <p className="mt-2 text-xs text-ink-muted">{t('outcomes.severeNote')}</p>
            <MasdFindings className="mt-5" findings={report.insights[who]} />
          </>
        ) : <p className="text-sm text-ink-muted">{t('outcomes.noCohort')}</p>}
        {!bench && <p className="mt-4 text-xs text-ink-muted">{t('outcomes.noBenchmark')}</p>}
      </Section>

      <Section icon={<Baby />} title={t('outcomes.bandsTitle')} subtitle={t('outcomes.bandsSub')} actions={bvToggle}>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 [&>*]:min-w-0">
          {BANDS.map(band => {
            const b = o.prevalence.bands[band];
            const nfhs = bench?.age_bands?.[band];
            const visits = (['bv', 'av', 'lv'] as Visit[]).filter(v => showBv || v !== 'bv');
            const table = (inds: Indicator[]) => {
              const showNfhs = !!nfhs && inds.some(i => nfhs[i] != null);
              return (
              <DataTable>
                <thead>
                  <tr>
                    <Th className="text-left" />
                    {showNfhs && <GroupTh span={1}>NFHS</GroupTh>}
                    <GroupTh span={visits.length}>{t('outcomes.mtflN', { n: b.mtfl.n })}</GroupTh>
                    <GroupTh span={visits.length}>{t('outcomes.otherN', { n: b.other.n })}</GroupTh>
                  </tr>
                  <tr>
                    <Th className="text-left">{t('outcomes.indicator')}</Th>
                    {showNfhs && <Th className="border-l-2 border-border-strong">{t('outcomes.stateBand', { band: t(`bands.${band}`) })}</Th>}
                    {visits.map((v, k) => <Th key={`m${v}`} className={k === 0 ? 'border-l-2 border-border-strong' : undefined}>{v.toUpperCase()}</Th>)}
                    {visits.map((v, k) => <Th key={`o${v}`} className={k === 0 ? 'border-l-2 border-border-strong' : undefined}>{v.toUpperCase()}</Th>)}
                  </tr>
                </thead>
                <tbody>
                  {inds.map(i => (
                    <tr key={i}>
                      <td className="px-3 py-2 font-medium text-ink">{t(`indicators.${i}`)}</td>
                      {showNfhs && <NfhsCell v={nfhs![i]} />}
                      {visits.map(v => <RateCell key={`m${v}`} value={b.mtfl.n ? b.mtfl[i][v] : null} lowerIsBetter />)}
                      {visits.map(v => <RateCell key={`o${v}`} value={b.other.n ? b.other[i][v] : null} lowerIsBetter />)}
                    </tr>
                  ))}
                </tbody>
              </DataTable>
              );
            };
            return (
              <div key={band} className="space-y-3">
                <h4 className="font-display text-base font-bold text-ink">
                  {t(`bands.${band}`)} <span className="text-sm font-normal text-ink-muted">· {t('outcomes.typesOf', { types: band === 'lt6' ? t('bands.lt6Types') : t('bands.m6_11Types') })}</span>
                </h4>
                {table(MAIN_INDICATORS)}
                <div className="text-xs font-semibold text-ink-muted">{t('outcomes.severeTitle')}</div>
                {table(SEVERE_INDICATORS)}
              </div>
            );
          })}
        </div>
        <MasdFindings className="mt-5" findings={report.insights.bands} />
      </Section>

      <Section icon={<Milestone />} title={t('outcomes.complianceTitle')} subtitle={t('outcomes.complianceSub')} actions={bvToggle}>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 [&>*]:min-w-0">
          {BANDS.map(band => {
            const c = o.compliance[band];
            const visits = (['bv', 'av', 'lv'] as Visit[]).filter(v => showBv || v !== 'bv');
            const cats = (['yes', 'no'] as const).flatMap(k => MAIN_INDICATORS.map(i => ({
              key: `${k}-${i}`, label: t(`indicators.${i}`),
              group: t(`outcomes.minMet.${k}`, { n: c[k].n }),
            })));
            return (
              <div key={band}>
                <h4 className="mb-1 font-display text-base font-bold text-ink">{t(`bands.${band}`)}</h4>
                <p className="mb-3 text-xs text-ink-muted">{t('outcomes.complianceRule', { visits: c.rule.min_visits, days: c.rule.min_follow_up_days })}</p>
                <GroupedColumns
                  categories={cats}
                  series={visits.map(v => ({
                    key: v, label: t(`outcomes.${v}Full`), color: VISIT_COLORS[v],
                    values: (['yes', 'no'] as const).flatMap(k => MAIN_INDICATORS.map(i => (c[k].n ? c[k][i][v] : null))),
                  }))}
                  height={190}
                  valueSuffix="%"
                />
                <MasdFindings className="mt-3" findings={report.insights[band === 'lt6' ? 'compliance_lt6' : 'compliance_6_11']} />
              </div>
            );
          })}
        </div>
      </Section>

      {cmp && (
        <Section icon={<TrendingDown />} title={t('progress.uwTitle')} subtitle={t('progress.uwSub')}>
          <DataTable>
            <thead>
              <tr><Th className="text-left">{t('progress.band')}</Th><Th>{t('progress.report')}</Th><Th>n</Th><Th>AV</Th><Th>LV</Th><Th>{t('progress.change')}</Th></tr>
            </thead>
            <tbody>
              {BANDS.flatMap(band => [cmp.then, cmp.now].map((snap, i) => {
                const u = snap.underweight[band];
                return (
                  <tr key={`${band}-${i}`}>
                    <td className="px-3 py-2 font-medium">{i === 0 ? t(`bands.${band}`) : ''}</td>
                    <td className="px-3 py-2 text-center text-ink-muted">
                      {i === 0 ? t('progress.interim') : t('progress.final')} · {new Date(snap.as_of).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">{u.n}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{fmt1(u.av)}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{fmt1(u.lv)}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{signed(u.abs_change, ` ${t('outcomes.pts')}`)}</td>
                  </tr>
                );
              }))}
            </tbody>
          </DataTable>
        </Section>
      )}

      {bench?.district_trend?.rounds?.length ? (
        <Section icon={<HeartPulse />} title={t('outcomes.trendTitle', { label: bench.district_trend.label })} subtitle={t('outcomes.trendSub')}>
          <GroupedColumns
            categories={MAIN_INDICATORS.map(i => ({ key: i, label: t(`indicators.${i}`) }))}
            series={bench.district_trend.rounds.map((round, k) => ({
              key: round, label: round, color: ['#D6CFC6', MASD_COLORS.then, MASD_COLORS.activity, MASD_COLORS.adoption][k % 4],
              values: MAIN_INDICATORS.map(i => bench.district_trend![i][k] ?? null),
            }))}
            height={180}
            valueSuffix="%"
          />
        </Section>
      ) : null}

      <Section icon={<Wrench />} title={t('outcomes.fixesTitle', { count: o.data_fixes.length })} subtitle={t('outcomes.fixesSub')}>
        {o.data_fixes.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('outcomes.fixesNone')}</p>
        ) : (
          <DataTable>
            <thead><tr><Th className="text-left">{t('table.learner')}</Th><Th>{t('table.block')}</Th><Th>{t('outcomes.cases')}</Th><Th className="text-left">{t('outcomes.whatToCheck')}</Th></tr></thead>
            <tbody>
              {o.data_fixes.map(f => (
                <tr key={f.id}>
                  <td className="px-3 py-2 font-medium">{f.name}</td>
                  <td className="px-3 py-2 text-center text-ink-muted">{f.block}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{f.cases}</td>
                  <td className="px-3 py-2 text-xs text-ink-muted">
                    {Object.entries(f.reasons).map(([k, n]) => `${t(`reasons.${k}`)} (${n})`).join(' · ')}
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

/** Where the babies were born × how (review of 7 Oct 2026), totals both ways. */
const PlaceByMethod: React.FC<{ report: MasdReport }> = ({ report }) => {
  const { t } = useTranslation('masd');
  const x = report.outcomes.demographics.place_by_method;
  if (!x || !x.places.length) return null;
  const n = (p: string, m: string) => x.counts[`${p}|${m}`] ?? 0;
  const row = (p: string) => x.methods.reduce((a, m) => a + n(p, m), 0);
  const col = (m: string) => x.places.reduce((a, p) => a + n(p, m), 0);
  const all = x.places.reduce((a, p) => a + row(p), 0);
  const share = (v: number, of: number) => (of ? `${Math.round((100 * v) / of)}%` : '—');
  return (
    <div className="mt-6">
      <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink"><Table2 className="size-4" />{t('demo.placeByMethod')}</h4>
      <DataTable>
        <thead>
          <tr>
            <Th className="text-left">{t('demo.delivery_place')}</Th>
            {x.methods.map(m => <Th key={m}>{m}</Th>)}
            <Th>{t('table.total')}</Th>
          </tr>
        </thead>
        <tbody>
          {x.places.map(p => (
            <tr key={p}>
              <td className="px-3 py-2 font-medium text-ink">{p}</td>
              {x.methods.map(m => (
                <td key={m} className="px-3 py-2 text-center tabular-nums">
                  {n(p, m)} <span className="text-xs text-ink-faint">({share(n(p, m), row(p))})</span>
                </td>
              ))}
              <td className="px-3 py-2 text-center font-semibold tabular-nums">{row(p)} <span className="text-xs font-normal text-ink-faint">({share(row(p), all)})</span></td>
            </tr>
          ))}
          <tr className="bg-surface-sunken/50 font-semibold">
            <td className="px-3 py-2">{t('table.total')}</td>
            {x.methods.map(m => <td key={m} className="px-3 py-2 text-center tabular-nums">{col(m)} <span className="text-xs font-normal text-ink-faint">({share(col(m), all)})</span></td>)}
            <td className="px-3 py-2 text-center tabular-nums">{all}</td>
          </tr>
        </tbody>
      </DataTable>
      <p className="mt-1 text-xs text-ink-muted">{t('demo.placeByMethodNote')}</p>
    </div>
  );
};

export default MasdOutcomes;
