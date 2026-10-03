import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Baby, ClipboardCheck, Filter, HeartPulse, Milestone, UserCheck, Users, Wrench } from 'lucide-react';
import {
  INDICATORS, MAIN_INDICATORS, type Band, type Benchmarks, type BenchValues, type Indicator, type MasdReport, type Prevalence,
} from '../../api/masd';
import { ChipRow, Section } from '../results/InsightParts';
import { BarList } from '../results/InsightCharts';
import MasdFindings from './MasdFindings';
import { DataTable, GroupedColumns, RateCell, Th } from './MasdCharts';
import { fmt1, MASD_COLORS } from '../../lib/masdDisplay';

const BANDS: Band[] = ['lt6', 'm6_11'];
const isSevere = (i: Indicator) => !(MAIN_INDICATORS as Indicator[]).includes(i);
/** As on NFHS fact sheets: each indicator, then its severe form. */
const ORDERED: Indicator[] = ['stunting', 'severe_stunting', 'underweight', 'severe_underweight', 'wasting', 'sam'];

/** The indicator's name; the severe forms indented under their parent. */
const IndicatorName: React.FC<{ i: Indicator }> = ({ i }) => {
  const { t } = useTranslation('masd');
  return isSevere(i)
    ? <td className="py-2 pl-7 pr-3 text-ink-muted">{t(`indicators.${i}`)}</td>
    : <td className="px-3 py-2 font-medium text-ink">{t(`indicators.${i}`)}</td>;
};

const PrevTable: React.FC<{ p: Prevalence; bench: Benchmarks | null; lt12: BenchValues | null; bands?: Band[] }> = ({ p, bench, lt12, bands = BANDS }) => {
  const { t } = useTranslation('masd');
  const ages = bench?.age_bands ?? {};
  const showBench = !!bench && bands.some(b => ages[b]);
  const under5 = bench?.under5 ?? null;
  return (
    <DataTable>
      <thead>
        <tr>
          <Th className="text-left">{t('outcomes.indicator')}</Th>
          {showBench && bands.map(b => <Th key={b} title={bench!.label}>{t('outcomes.nfhsBand', { band: t(`bands.${b}`) })}</Th>)}
          {lt12 && <Th title={t('outcomes.lt12Title')}>{t('outcomes.nfhsLt12')}</Th>}
          {under5 && <Th title={bench!.label}>{t('outcomes.nfhsUnder5')}</Th>}
          <Th title={t('outcomes.bvFull')}>BV</Th>
          <Th title={t('outcomes.avFull')}>AV</Th>
          <Th title={t('outcomes.lvFull')}>LV</Th>
          <Th>{t('outcomes.absChange')}</Th>
          <Th>{t('outcomes.relChange')}</Th>
        </tr>
      </thead>
      <tbody>
        {ORDERED.filter(i => p[i]).map(i => {
          const x = p[i];
          return (
            <tr key={i}>
              <IndicatorName i={i} />
              {showBench && bands.map(b => (
                <td key={b} className="px-3 py-2 text-center tabular-nums text-ink-muted">{fmt1(ages[b]?.[i] ?? null)}</td>
              ))}
              {lt12 && <td className="px-3 py-2 text-center tabular-nums text-ink-muted">{fmt1(lt12[i] ?? null)}</td>}
              {under5 && <td className="px-3 py-2 text-center tabular-nums text-ink-muted">{fmt1(under5[i] ?? null)}</td>}
              <RateCell value={x.bv} lowerIsBetter />
              <RateCell value={x.av} lowerIsBetter />
              <RateCell value={x.lv} lowerIsBetter />
              <td className="px-3 py-2 text-center tabular-nums">{x.abs_change == null ? '—' : `${x.abs_change > 0 ? '+' : ''}${x.abs_change.toFixed(1)} ${t('outcomes.pts')}`}</td>
              <td className="px-3 py-2 text-center tabular-nums">{x.rel_change == null ? '—' : `${x.rel_change > 0 ? '+' : ''}${x.rel_change.toFixed(1)}%`}</td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
};

type Who = 'overall' | 'mtfl' | 'other';

const MasdOutcomes: React.FC<{ report: MasdReport }> = ({ report }) => {
  const { t } = useTranslation('masd');
  const o = report.outcomes;
  const ex = o.exclusions;
  const [who, setWho] = useState<Who>('overall');
  const prev = o.prevalence[who];
  const bench = o.benchmarks;
  const indCats = MAIN_INDICATORS.map(i => ({ key: i, label: t(`indicators.${i}`) }));
  const allCats = INDICATORS.map(i => ({ key: i, label: t(`indicators.${i}`) }));
  const funnelLabel: Record<string, string> = {
    start: t('outcomes.funnelStart'), no_f2f: t('outcomes.funnelNoF2f'), nursing_staff: t('outcomes.funnelNurses'),
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 [&>*]:min-w-0">
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

        <Section icon={<ClipboardCheck />} title={t('outcomes.exclTitle')} subtitle={t('outcomes.exclSub')}>
          <DataTable>
            <thead>
              <tr><Th className="text-left">{t('outcomes.reason')}</Th><Th>MT+FL</Th><Th>{t('outcomes.other')}</Th><Th>{t('table.total')}</Th></tr>
            </thead>
            <tbody>
              {ex.reasons.filter(r => r.total > 0).map(r => (
                <tr key={r.key}>
                  <td className="px-3 py-1.5 text-xs text-ink sm:text-sm">{t(`reasons.${r.key}`, { defaultValue: r.label })}</td>
                  <td className="px-3 py-1.5 text-center tabular-nums">{r.mtfl}</td>
                  <td className="px-3 py-1.5 text-center tabular-nums">{r.other}</td>
                  <td className="px-3 py-1.5 text-center tabular-nums font-semibold">{r.total}</td>
                </tr>
              ))}
              <tr className="bg-success-50/60 font-semibold dark:bg-success-500/10">
                <td className="px-3 py-2">{t('outcomes.included')}</td>
                <td className="px-3 py-2 text-center">{ex.included.mtfl} <span className="text-xs font-normal">({fmt1(ex.inclusion_pct_mtfl)})</span></td>
                <td className="px-3 py-2 text-center">{ex.included.other} <span className="text-xs font-normal">({fmt1(ex.inclusion_pct_other)})</span></td>
                <td className="px-3 py-2 text-center">{ex.included.total} <span className="text-xs font-normal">({fmt1(ex.inclusion_pct)})</span></td>
              </tr>
              <tr className="font-semibold">
                <td className="px-3 py-2">{t('table.total')}</td>
                <td className="px-3 py-2 text-center">{ex.total.mtfl}</td>
                <td className="px-3 py-2 text-center">{ex.total.other}</td>
                <td className="px-3 py-2 text-center">{ex.total.total}</td>
              </tr>
            </tbody>
          </DataTable>
        </Section>
      </div>

      <Section icon={<UserCheck />} title={t('outcomes.retentionTitle')} subtitle={t('outcomes.retentionSub')}>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 [&>*]:min-w-0">
          {(['learners', 'adoptions'] as const).map(kind => (
            <DataTable key={kind}>
              <thead>
                <tr>
                  <Th className="text-left">{t('table.cadre')}</Th>
                  <Th>{t(`outcomes.ret_${kind}`)}</Th>
                  <Th>{t('outcomes.inFinal')}</Th>
                  <Th>{t('outcomes.retained')}</Th>
                </tr>
              </thead>
              <tbody>
                {o.retention[kind].map(r => (
                  <tr key={r.role_group} className={r.role_group === 'Total' ? 'font-semibold' : undefined}>
                    <td className="px-3 py-2">{r.role_group === 'Total' ? t('table.total') : r.role_group}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{r.total}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{r.final}</td>
                    <RateCell value={r.pct} />
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ))}
        </div>
      </Section>

      <Section icon={<Users />} title={t('outcomes.demoTitle', { n: o.demographics.n.toLocaleString() })} subtitle={t('outcomes.demoSub')}>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
          {(['mother_age', 'ration_card', 'social_category', 'delivery_place', 'delivery_method'] as const).map(key => (
            <div key={key}>
              <h4 className="mb-3 text-sm font-semibold text-ink">{t(`demo.${key}`)}</h4>
              <BarList
                max={100}
                rows={o.demographics[key].filter(x => x.n > 0).map(x => ({
                  key: x.label, label: x.label, value: x.pct ?? 0, display: fmt1(x.pct), sub: `n=${x.n}`, color: MASD_COLORS.activity,
                }))}
              />
            </div>
          ))}
          <p className="self-end text-xs text-ink-muted">{t('outcomes.familyTypeNote')}</p>
        </div>
      </Section>

      <Section
        icon={<HeartPulse />}
        title={t('outcomes.prevTitle')}
        subtitle={t('outcomes.prevSub')}
        actions={
          <ChipRow label="" value={who} onChange={v => setWho(v as Who)}
            items={[{ key: 'overall', label: t('outcomes.overall') }, { key: 'mtfl', label: 'MT+FL' }, { key: 'other', label: t('outcomes.otherLearners') }]} />
        }
      >
        {prev.n ? (
          <>
            <p className="mb-3 text-sm text-ink-muted">{t('outcomes.nDyads', { n: prev.n.toLocaleString() })}</p>
            <PrevTable p={prev} bench={bench} lt12={o.benchmarks_lt12} />
            <div className="mt-5">
              <GroupedColumns
                categories={allCats}
                series={[
                  { key: 'bv', label: t('outcomes.bvFull'), color: '#D6CFC6', values: INDICATORS.map(i => prev[i].bv) },
                  { key: 'av', label: t('outcomes.avFull'), color: MASD_COLORS.then, values: INDICATORS.map(i => prev[i].av) },
                  { key: 'lv', label: t('outcomes.lvFull'), color: MASD_COLORS.activity, values: INDICATORS.map(i => prev[i].lv) },
                ]}
                height={200}
                valueSuffix="%"
              />
            </div>
            <MasdFindings className="mt-5" findings={report.insights[who]} />
          </>
        ) : <p className="text-sm text-ink-muted">{t('outcomes.noCohort')}</p>}
        {!bench && <p className="mt-4 text-xs text-ink-muted">{t('outcomes.noBenchmark')}</p>}
      </Section>

      <Section icon={<Baby />} title={t('outcomes.bandsTitle')} subtitle={t('outcomes.bandsSub')}>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 [&>*]:min-w-0">
          {BANDS.map(band => {
            const b = o.prevalence.bands[band];
            return (
              <div key={band}>
                <h4 className="mb-2 font-display text-base font-bold text-ink">
                  {t(`bands.${band}`)} <span className="text-sm font-normal text-ink-muted">· {t('outcomes.typesOf', { types: band === 'lt6' ? t('bands.lt6Types') : t('bands.m6_11Types') })}</span>
                </h4>
                <DataTable>
                  <thead>
                    <tr>
                      <Th className="text-left">{t('outcomes.indicator')}</Th>
                      {bench?.age_bands?.[band] && <Th>NFHS</Th>}
                      <Th>MT+FL AV</Th><Th>MT+FL LV</Th><Th>{t('outcomes.otherShort')} AV</Th><Th>{t('outcomes.otherShort')} LV</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {ORDERED.map(i => (
                      <tr key={i}>
                        <IndicatorName i={i} />
                        {bench?.age_bands?.[band] && <td className="px-3 py-2 text-center text-ink-muted">{fmt1(bench.age_bands[band]?.[i] ?? null)}</td>}
                        <RateCell value={b.mtfl.n ? b.mtfl[i].av : null} lowerIsBetter />
                        <RateCell value={b.mtfl.n ? b.mtfl[i].lv : null} lowerIsBetter />
                        <RateCell value={b.other.n ? b.other[i].av : null} lowerIsBetter />
                        <RateCell value={b.other.n ? b.other[i].lv : null} lowerIsBetter />
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
                <p className="mt-2 text-xs text-ink-faint">MT+FL n={b.mtfl.n} · {t('outcomes.otherShort')} n={b.other.n}</p>
              </div>
            );
          })}
        </div>
        <MasdFindings className="mt-5" findings={report.insights.bands} />
      </Section>

      <Section icon={<Milestone />} title={t('outcomes.complianceTitle')} subtitle={t('outcomes.complianceSub')}>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 [&>*]:min-w-0">
          {BANDS.map(band => {
            const c = o.compliance[band];
            return (
              <div key={band}>
                <h4 className="mb-1 font-display text-base font-bold text-ink">{t(`bands.${band}`)}</h4>
                <p className="mb-3 text-xs text-ink-muted">{t('outcomes.complianceRule', { visits: c.rule.min_visits, days: c.rule.min_follow_up_days })}</p>
                <GroupedColumns
                  categories={indCats}
                  series={[
                    { key: 'ya', label: t('outcomes.yesAv'), color: '#9FC5CC', values: MAIN_INDICATORS.map(i => (c.yes.n ? c.yes[i].av : null)) },
                    { key: 'yl', label: t('outcomes.yesLv'), color: MASD_COLORS.adoption, values: MAIN_INDICATORS.map(i => (c.yes.n ? c.yes[i].lv : null)) },
                    { key: 'na', label: t('outcomes.noAv'), color: '#F2B8AE', values: MAIN_INDICATORS.map(i => (c.no.n ? c.no[i].av : null)) },
                    { key: 'nl', label: t('outcomes.noLv'), color: MASD_COLORS.activity, values: MAIN_INDICATORS.map(i => (c.no.n ? c.no[i].lv : null)) },
                  ]}
                  height={180}
                  valueSuffix="%"
                />
                <p className="mt-2 text-xs text-ink-faint">{t('outcomes.yes')} n={c.yes.n} · {t('outcomes.no')} n={c.no.n}</p>
                <MasdFindings className="mt-3" findings={report.insights[band === 'lt6' ? 'compliance_lt6' : 'compliance_6_11']} />
              </div>
            );
          })}
        </div>
      </Section>

      {bench?.district_trend?.rounds?.length ? (
        <Section icon={<HeartPulse />} title={t('outcomes.trendTitle', { label: bench.district_trend.label })} subtitle={t('outcomes.trendSub')}>
          <GroupedColumns
            categories={indCats}
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

export default MasdOutcomes;
