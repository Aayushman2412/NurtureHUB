import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChartColumn, ChartScatter, Layers, Map as MapIcon, Scale, Table2 } from 'lucide-react';
import { ACTIVITY_KEYS, type MasdGroup, type MasdReport } from '../../api/masd';
import { ChipRow, Section } from '../results/InsightParts';
import MasdFindings from './MasdFindings';
import { BubblePlot, DataTable, GroupedColumns, RateCell, Th } from './MasdCharts';
import { fmt1, MASD_COLORS } from '../../lib/masdDisplay';

type Split = 'blocks' | 'roles';
const WCD_ROLES = ['AWW', 'AWSup'];

const MasdActivity: React.FC<{ report: MasdReport }> = ({ report }) => {
  const { t } = useTranslation('masd');
  const [split, setSplit] = useState<Split>('blocks');
  const groups = (split === 'blocks' ? report.blocks : report.roles).filter(g => g.learners > 0);
  const total = report.summary;
  const word = t(`split.${split}One`);

  const categories = groups.map(g => ({ key: g.key, label: g.label, sub: `n=${g.learners}` }));

  return (
    <div className="space-y-5">
      <ChipRow
        label={t('split.label')}
        value={split}
        onChange={v => setSplit(v as Split)}
        items={[{ key: 'blocks', label: t('split.blocks') }, { key: 'roles', label: t('split.roles') }]}
      />

      <Section icon={<ChartColumn />} title={t('activity.fulfilTitle', { what: word })} subtitle={t('activity.fulfilSub')}>
        <GroupedColumns
          categories={categories}
          series={[
            { key: 'adopt', label: t('activity.adoptionPct'), color: MASD_COLORS.adoption, values: groups.map(g => g.fulfilment_pct) },
            { key: 'act', label: t('activity.activityPct'), color: MASD_COLORS.activity, values: groups.map(g => g.intensity_pct) },
          ]}
          reference={{ value: 100, label: t('activity.targetLine') }}
          valueSuffix="%"
        />
        <MasdFindings className="mt-5" findings={report.insights[split]} />
      </Section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5 [&>*]:min-w-0">
        <Section className="xl:col-span-3" icon={<ChartScatter />} title={t('activity.bubbleTitle', { what: word })} subtitle={t('activity.bubbleSub')}>
          <BubblePlot
            bubbles={groups.filter(g => g.fulfilment_pct != null && g.intensity_pct != null).map(g => ({
              key: g.key, label: g.label, x: g.fulfilment_pct!, y: g.intensity_pct!, size: g.learners,
            }))}
            xLabel={t('activity.bubbleX')}
            yLabel={t('activity.bubbleY')}
            quadrant={{
              topRight: t('activity.qTopRight'), topLeft: t('activity.qTopLeft'),
              bottomRight: t('activity.qBottomRight'), bottomLeft: t('activity.qBottomLeft'),
            }}
            sizeLabel={n => t('activity.learnersN', { count: n })}
          />
        </Section>
        <Section className="xl:col-span-2" icon={<Table2 />} title={t('activity.dataTitle')} subtitle={t('activity.dataSub')}>
          <DataTable>
            <thead>
              <tr>
                <Th className="text-left">{word}</Th>
                <Th>{t('table.learners')}</Th>
                <Th>{t('table.fulfilment')}</Th>
                <Th>{t('table.intensity')}</Th>
                <Th>{t('table.nilDays')}</Th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => <GroupRow key={g.key} g={g} />)}
              <GroupRow g={{ ...total, label: t('table.total') }} bold />
            </tbody>
          </DataTable>
        </Section>
      </div>

      <Section icon={<Layers />} title={t('activity.subtypeTitle', { what: word })} subtitle={t('activity.subtypeSub')}>
        <DataTable>
          <thead>
            <tr>
              <Th className="text-left">{word}</Th>
              <Th>{t('table.learners')}</Th>
              {ACTIVITY_KEYS.map(k => <Th key={k}>{t(`activities.${k}`)}</Th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <tr key={g.key}>
                <td className="px-3 py-2 font-medium text-ink">{g.label}</td>
                <td className="px-3 py-2 text-center tabular-nums text-ink-muted">{g.learners}</td>
                {ACTIVITY_KEYS.map(k => <RateCell key={k} value={g.subtype_pct[k]} />)}
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="px-3 py-2 text-ink">{t('table.total')}</td>
              <td className="px-3 py-2 text-center tabular-nums">{total.learners}</td>
              {ACTIVITY_KEYS.map(k => <RateCell key={k} value={total.subtype_pct[k]} />)}
            </tr>
          </tbody>
        </DataTable>
        <div className="mt-5">
          <GroupedColumns
            categories={categories}
            series={ACTIVITY_KEYS.map(k => ({
              key: k, label: t(`activities.${k}`), color: MASD_COLORS[k], values: groups.map(g => g.subtype_pct[k]),
            }))}
            reference={{ value: 100, label: t('activity.idealLine') }}
            valueSuffix="%"
          />
        </div>
        <MasdFindings className="mt-5" findings={report.insights.subtypes} />
      </Section>

      {split === 'roles' ? (
        <Section icon={<Scale />} title={t('activity.targetsTitle')} subtitle={t('activity.targetsSub')}>
          <DataTable>
            <thead>
              <tr>
                <Th className="text-left">{t('table.cadre')}</Th>
                <Th>{t('table.learners')}</Th>
                <Th>{t('activity.adoptTarget')}</Th>
                <Th>{t('activity.actual')}</Th>
                <Th>{t('table.fulfilment')}</Th>
                <Th>{t('activity.actExpected')}</Th>
                <Th>{t('activity.actual')}</Th>
                <Th>{t('table.intensity')}</Th>
              </tr>
            </thead>
            <tbody>
              {(['WCD', 'HFW'] as const).flatMap(dept => {
                const members = report.roles.filter(g => g.learners > 0 && (dept === 'WCD') === WCD_ROLES.includes(g.key));
                const sub = report.departments.find(d => d.key === dept);
                return [
                  ...members.map(g => <TargetRow key={g.key} g={g} />),
                  ...(sub && sub.learners ? [<TargetRow key={`sub-${dept}`} g={{ ...sub, label: t(`activity.subtotal${dept}`) }} bold />] : []),
                ];
              })}
              <TargetRow g={{ ...report.departments[report.departments.length - 1], label: t('activity.grandTotal') }} bold />
            </tbody>
          </DataTable>
        </Section>
      ) : (
        <Section icon={<MapIcon />} title={t('activity.distributionTitle')} subtitle={t('activity.distributionSub')}>
          <Distribution report={report} />
        </Section>
      )}
    </div>
  );
};

const GroupRow: React.FC<{ g: MasdGroup; bold?: boolean }> = ({ g, bold }) => (
  <tr className={bold ? 'font-semibold' : undefined}>
    <td className="px-3 py-2 text-ink">{g.label}</td>
    <td className="px-3 py-2 text-center tabular-nums text-ink-muted">{g.learners}</td>
    <td className="px-3 py-2 text-center tabular-nums">{fmt1(g.fulfilment_pct)}</td>
    <RateCell value={g.intensity_pct} />
    <td className="px-3 py-2 text-center tabular-nums">{fmt1(g.nil_days_avg, '')}</td>
  </tr>
);

const TargetRow: React.FC<{ g: MasdGroup; bold?: boolean }> = ({ g, bold }) => (
  <tr className={bold ? 'bg-surface-sunken/50 font-semibold' : undefined}>
    <td className="px-3 py-2 text-ink">{g.label}</td>
    <td className="px-3 py-2 text-center tabular-nums">{g.learners}</td>
    <td className="px-3 py-2 text-center tabular-nums">{g.target.toLocaleString()}</td>
    <td className="px-3 py-2 text-center tabular-nums">{g.adoptions.toLocaleString()}</td>
    <RateCell value={g.fulfilment_pct} />
    <td className="px-3 py-2 text-center tabular-nums">{Math.round(g.ideal).toLocaleString()}</td>
    <td className="px-3 py-2 text-center tabular-nums">{g.activities.toLocaleString()}</td>
    <RateCell value={g.intensity_pct} />
  </tr>
);

const Distribution: React.FC<{ report: MasdReport }> = ({ report }) => {
  const { t } = useTranslation('masd');
  const blocks = Object.keys(report.distribution).sort();
  const roles = report.roles.filter(g => g.learners > 0).map(g => g.key);
  const total = blocks.reduce((a, b) => a + Object.values(report.distribution[b]).reduce((x, y) => x + y, 0), 0);
  return (
    <DataTable>
      <thead>
        <tr>
          <Th className="text-left">{t('table.block')}</Th>
          {roles.map(r => <Th key={r}>{r}</Th>)}
          <Th>{t('table.total')}</Th>
        </tr>
      </thead>
      <tbody>
        {blocks.map(b => {
          const row = report.distribution[b];
          const n = Object.values(row).reduce((x, y) => x + y, 0);
          return (
            <tr key={b}>
              <td className="px-3 py-2 font-medium text-ink">{b}</td>
              {roles.map(r => (
                <td key={r} className="px-3 py-2 text-center tabular-nums">
                  {row[r] ? <>{row[r]} <span className="text-xs text-ink-faint">({Math.round((100 * row[r]) / n)}%)</span></> : <span className="text-ink-faint">—</span>}
                </td>
              ))}
              <td className="px-3 py-2 text-center font-semibold tabular-nums">
                {n} <span className="text-xs font-normal text-ink-faint">({Math.round((100 * n) / Math.max(total, 1))}%)</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
};

export default MasdActivity;
