import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { Activity, AlertTriangle } from 'lucide-react';
import { getResponse } from '../../api/forms';
import {
  getGrowthStandards,
  getMyGrowthCases,
  type GrowthCase,
  type GrowthStandards,
} from '../../api/growth';
import GrowthChartGrid, { GrowthLegend } from '../../components/growth/GrowthChartGrid';
import VisitDetailModal from '../../components/growth/VisitDetailModal';
import { Button, buttonClasses, Chip, EmptyState, PageHeader, PageLoader, Tabs } from '../../components/ui';
import {
  caseHasCohortData,
  sexKeyForGender,
  type GrowthCohort,
  type GrowthPoint,
} from '../../lib/growthChart';

/**
 * Learner growth view: WHO growth charts for the learner's own cases —
 * per case (child) with only the applicable charts, or all cases together.
 */
const GrowthChartsPage: React.FC = () => {
  const { t } = useTranslation('growth');
  const [searchParams, setSearchParams] = useSearchParams();

  const [standards, setStandards] = useState<GrowthStandards | null>(null);
  const [cases, setCases] = useState<GrowthCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sexTab, setSexTab] = useState<'boys' | 'girls'>('boys');
  const [detailPoint, setDetailPoint] = useState<GrowthPoint | null>(null);

  const selectedChildId = searchParams.get('child'); // null = all cases

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    Promise.all([getGrowthStandards(), getMyGrowthCases()])
      .then(([std, mine]) => {
        setStandards(std);
        setCases(mine.cases);
        const genders = new Set(mine.cases.map(c => sexKeyForGender(c.child.gender)));
        if (!genders.has('boys') && genders.has('girls')) setSexTab('girls');
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectCase = (childId: number | null) => {
    if (childId == null) setSearchParams({});
    else setSearchParams({ child: String(childId) });
  };

  const selectedCase = useMemo(
    () => cases.find(c => String(c.child.id) === selectedChildId) ?? null,
    [cases, selectedChildId],
  );

  const allCasesForTab = useMemo(
    () => cases.filter(c => sexKeyForGender(c.child.gender) === sexTab),
    [cases, sexTab],
  );

  const counts = useMemo(
    () => ({
      boys: cases.filter(c => sexKeyForGender(c.child.gender) === 'boys').length,
      girls: cases.filter(c => sexKeyForGender(c.child.gender) === 'girls').length,
    }),
    [cases],
  );

  const fetchResponse = useCallback((id: number) => getResponse(id), []);

  if (loadError && !standards) {
    return (
      <>
        <PageHeader title={t('learner.title')} description={t('learner.description')} />
        <EmptyState
          icon={<AlertTriangle className="size-8" />}
          title={t('errors.loadFailedTitle')}
          description={t('errors.loadFailedBody')}
          action={<Button onClick={load}>{t('errors.retry')}</Button>}
        />
      </>
    );
  }

  if (loading || !standards) {
    return <PageLoader label={t('learner.loading')} />;
  }

  if (cases.length === 0) {
    return (
      <>
        <PageHeader title={t('learner.title')} description={t('learner.description')} />
        <EmptyState
          icon={<Activity className="size-8" />}
          title={t('learner.noCases')}
          description={t('learner.noCasesHint')}
          action={
            <Link to="/mothers" className={buttonClasses('primary', 'md')}>
              {t('learner.registerCta')}
            </Link>
          }
        />
      </>
    );
  }

  // Single-case view: only the charts that apply to this child (its sex, and
  // the age cohorts it actually has data for — all 6 when applicable).
  const selectedSex = selectedCase ? sexKeyForGender(selectedCase.child.gender) : null;
  const selectedCohorts: GrowthCohort[] = selectedCase
    ? (['young', 'old'] as const).filter(cohort => caseHasCohortData(selectedCase, cohort))
    : [];

  return (
    <>
      <PageHeader title={t('learner.title')} description={t('learner.description')} />

      {/* case selector */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Chip selected={selectedCase == null} onClick={() => selectCase(null)}>
          {t('learner.allCases')}
        </Chip>
        {cases.map(c => (
          <Chip
            key={c.child.id}
            selected={selectedCase?.child.id === c.child.id}
            count={c.visits.filter(v => v.weight != null || v.length != null).length}
            onClick={() => selectCase(c.child.id)}
          >
            {t('learner.caseLabel', { child: c.child.name, mother: c.mother.name })}
          </Chip>
        ))}
      </div>

      <div className="mb-4">
        <GrowthLegend />
      </div>

      {selectedCase ? (
        selectedSex == null ? (
          <EmptyState
            icon={<Activity className="size-8" />}
            title={selectedCase.child.name}
            description={t('learner.noGender')}
          />
        ) : selectedCohorts.length === 0 ? (
          <EmptyState
            icon={<Activity className="size-8" />}
            title={selectedCase.child.name}
            description={t('learner.noVisits')}
          />
        ) : (
          <GrowthChartGrid
            cases={[selectedCase]}
            sex={selectedSex}
            standards={standards}
            cohorts={selectedCohorts}
            onPointClick={setDetailPoint}
          />
        )
      ) : (
        <div className="space-y-4">
          <Tabs
            value={sexTab}
            onChange={setSexTab}
            items={[
              { value: 'boys' as const, label: `${t('sexTabs.boys')} (${counts.boys})` },
              { value: 'girls' as const, label: `${t('sexTabs.girls')} (${counts.girls})` },
            ]}
          />
          {allCasesForTab.length === 0 ? (
            <EmptyState
              icon={<Activity className="size-8" />}
              title={t('learner.noCasesForSex')}
              description={t('learner.noCasesForSexHint')}
            />
          ) : (
            <GrowthChartGrid
              cases={allCasesForTab}
              sex={sexTab}
              standards={standards}
              onPointClick={setDetailPoint}
            />
          )}
        </div>
      )}

      <VisitDetailModal
        point={detailPoint}
        onClose={() => setDetailPoint(null)}
        fetchResponse={fetchResponse}
      />
    </>
  );
};

export default GrowthChartsPage;
