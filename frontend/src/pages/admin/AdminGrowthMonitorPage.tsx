import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import client from '../../api/client';
import {
  getAdminGrowthMonitor,
  getAdminGrowthResponse,
  getGrowthStandards,
  type GrowthCase,
  type GrowthStandards,
} from '../../api/growth';
import GrowthChartGrid, { GrowthLegend } from '../../components/growth/GrowthChartGrid';
import VisitDetailModal from '../../components/growth/VisitDetailModal';
import { AlertTriangle } from 'lucide-react';
import { Button, Chip, EmptyState, PageLoader, SelectField, Tabs } from '../../components/ui';
import { sexKeyForGender, type GrowthPoint } from '../../lib/growthChart';

interface ProgramDistrict {
  id: number;
  name: string;
  slug: string;
}

/**
 * Admin Growth Monitor: WHO growth charts for every learner-mother-child case
 * across all districts. Six charts per sex (2 age cohorts × weight-for-age /
 * length-for-age / weight-for-length); learner-mother pairs can be toggled in
 * and out of the plots.
 */
const AdminGrowthMonitorPage: React.FC = () => {
  const { t } = useTranslation('growth');

  const [standards, setStandards] = useState<GrowthStandards | null>(null);
  const [cases, setCases] = useState<GrowthCase[]>([]);
  const [districts, setDistricts] = useState<ProgramDistrict[]>([]);
  const [district, setDistrict] = useState(''); // '' = all districts
  const [loading, setLoading] = useState(true);
  const [standardsError, setStandardsError] = useState(false);
  const [sexTab, setSexTab] = useState<'boys' | 'girls'>('boys');
  const [excludedMothers, setExcludedMothers] = useState<Set<number>>(new Set());
  const [detailPoint, setDetailPoint] = useState<GrowthPoint | null>(null);

  const loadStandards = useCallback(() => {
    setStandardsError(false);
    getGrowthStandards()
      .then(setStandards)
      .catch(() => setStandardsError(true));
  }, []);

  useEffect(() => {
    loadStandards();
    client
      .get<ProgramDistrict[]>('/api/admin/districts')
      .then(res => setDistricts(res.data))
      .catch(() => {});
  }, [loadStandards]);

  useEffect(() => {
    setLoading(true);
    getAdminGrowthMonitor(district || undefined)
      .then(res => setCases(res.cases))
      .catch(() => setCases([]))
      .finally(() => setLoading(false));
  }, [district]);

  // Learner–mother pairs (the filter unit): one chip per mother, listing her
  // children and how many plotted visits the pair contributes.
  const pairs = useMemo(() => {
    const byMother = new Map<
      number,
      { motherId: number; label: string; childNames: string[]; visitCount: number }
    >();
    for (const c of cases) {
      const entry = byMother.get(c.mother.id) ?? {
        motherId: c.mother.id,
        label: `${c.learner.name ?? t('admin.orphanLearner')} · ${c.mother.name}`,
        childNames: [],
        visitCount: 0,
      };
      entry.childNames.push(c.child.name);
      entry.visitCount += c.visits.filter(v => v.weight != null || v.length != null).length;
      byMother.set(c.mother.id, entry);
    }
    return [...byMother.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [cases, t]);

  const togglePair = (motherId: number) => {
    setExcludedMothers(prev => {
      const next = new Set(prev);
      if (next.has(motherId)) next.delete(motherId);
      else next.add(motherId);
      return next;
    });
  };

  const includedCases = useMemo(
    () => cases.filter(c => !excludedMothers.has(c.mother.id)),
    [cases, excludedMothers],
  );

  const sexCases = useMemo(
    () => includedCases.filter(c => sexKeyForGender(c.child.gender) === sexTab),
    [includedCases, sexTab],
  );

  const counts = useMemo(
    () => ({
      boys: includedCases.filter(c => sexKeyForGender(c.child.gender) === 'boys').length,
      girls: includedCases.filter(c => sexKeyForGender(c.child.gender) === 'girls').length,
    }),
    [includedCases],
  );

  const fetchResponse = useCallback((id: number) => getAdminGrowthResponse(id), []);

  if (standardsError && !standards) {
    return (
      <EmptyState
        icon={<AlertTriangle className="size-8" />}
        title={t('errors.loadFailedTitle')}
        description={t('errors.loadFailedBody')}
        action={<Button onClick={loadStandards}>{t('errors.retry')}</Button>}
      />
    );
  }

  if (loading || !standards) {
    return <PageLoader label={t('admin.loading')} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-ink">{t('admin.title')}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t('admin.description')}</p>
        </div>
        <div className="w-56">
          <SelectField
            label={t('admin.district')}
            value={district}
            onChange={setDistrict}
            placeholder={t('admin.allDistricts')}
            options={districts.map(d => ({ value: d.slug, label: d.name }))}
          />
        </div>
      </div>

      {/* learner–mother pair filter */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-bold text-ink">{t('admin.pairs')}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setExcludedMothers(new Set())}>
              {t('admin.selectAll')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExcludedMothers(new Set(pairs.map(p => p.motherId)))}
            >
              {t('admin.clearAll')}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {pairs.map(pair => (
            <Chip
              key={pair.motherId}
              selected={!excludedMothers.has(pair.motherId)}
              count={pair.visitCount}
              onClick={() => togglePair(pair.motherId)}
              title={pair.childNames.join(', ')}
            >
              {pair.label}
            </Chip>
          ))}
          {pairs.length === 0 && (
            <span className="text-sm text-ink-muted">{t('admin.noCases')}</span>
          )}
        </div>
      </div>

      <GrowthLegend />

      <Tabs
        value={sexTab}
        onChange={setSexTab}
        items={[
          { value: 'boys' as const, label: `${t('sexTabs.boys')} (${counts.boys})` },
          { value: 'girls' as const, label: `${t('sexTabs.girls')} (${counts.girls})` },
        ]}
      />

      {sexCases.length === 0 ? (
        <EmptyState
          icon={<Activity className="size-8" />}
          title={t('admin.noCasesTitle')}
          description={t('admin.noCases')}
        />
      ) : (
        <GrowthChartGrid
          cases={sexCases}
          sex={sexTab}
          standards={standards}
          onPointClick={setDetailPoint}
        />
      )}

      <VisitDetailModal
        point={detailPoint}
        onClose={() => setDetailPoint(null)}
        fetchResponse={fetchResponse}
      />
    </div>
  );
};

export default AdminGrowthMonitorPage;
