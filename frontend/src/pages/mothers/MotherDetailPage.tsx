import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Baby, ChevronRight, Heart, Ruler, Utensils, Activity } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader, PageLoader } from '../../components/ui';
import LearnerMotherCard from '../../components/mothers/LearnerMotherCard';
import { useToast } from '../../context/ToastContext';
import { getMother, type Mother } from '../../api/mothers';
import { listChildren, type ChildListItem } from '../../api/children';
import { CF_MIN_AGE_DAYS } from '../../lib/flowTypes';

/** Whole days since an ISO date of birth; null when unknown/invalid. */
const ageInDays = (dob: string | null): number | null => {
  if (!dob) return null;
  const d = new Date(`${dob.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
};

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex justify-between gap-4 border-b border-border py-2 text-sm last:border-b-0">
    <span className="text-ink-muted">{label}</span>
    <span className="text-right font-medium text-ink">{value ?? '—'}</span>
  </div>
);

const MotherDetailPage: React.FC = () => {
  const { id } = useParams();
  const motherId = Number(id);
  const navigate = useNavigate();
  const { t } = useTranslation('mother');
  const { showToast } = useToast();
  const [mother, setMother] = useState<Mother | null>(null);
  const [children, setChildren] = useState<ChildListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getMother(motherId), listChildren(motherId)])
      .then(([m, kids]) => { setMother(m); setChildren(kids); })
      .catch(() => showToast(t('detail.loadFailed'), 'error'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motherId]);

  if (loading) return <PageLoader label={t('detail.loading')} className="min-h-60" />;
  if (!mother) return null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title={mother.mother_name} description={mother.mother_uid} backTo="/mothers" />

      <LearnerMotherCard mother={mother} />

      <Card className="p-6">
        <h3 className="mb-3 font-display text-lg font-bold text-ink">{t('detail.clinical')}</h3>
        <Row label={t('detail.rowAge')} value={mother.mother_age ? t('detail.ageValue', { n: mother.mother_age }) : null} />
        <Row label={t('detail.rowWeightHeight')} value={mother.weight && mother.height ? t('detail.weightHeightValue', { weight: mother.weight, height: mother.height }) : null} />
        <Row label={t('detail.rowLmp')} value={mother.lmp} />
        <Row label={t('detail.rowEdd')} value={`${mother.edd_lmp || '—'} / ${mother.edd_records || '—'}`} />
        <Row label={t('detail.rowGestational')} value={mother.gestational_weeks != null ? t('detail.gestationalValue', { weeks: mother.gestational_weeks, months: mother.gestational_months }) : null} />
        <Row label={t('detail.rowMobile')} value={mother.mobile} />
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-ink">
            {t('detail.children')} {children.length > 0 && <span className="text-ink-muted">({children.length})</span>}
          </h3>
          <Button variant="secondary" onClick={() => navigate(`/mothers/${motherId}/children/new`)}>
            <Plus className="size-4" /> {t('detail.addChild')}
          </Button>
        </div>

        {children.length === 0 ? (
          <EmptyState
            icon={<Baby />}
            title={t('detail.childrenEmptyTitle')}
            description={t('detail.childrenEmptyBody')}
          />
        ) : (
          <div className="flex flex-col gap-2">
            {children.map(c => {
              const days = ageInDays(c.dob);
              const cfLocked = days == null || days < CF_MIN_AGE_DAYS;
              const cfTooltip = !cfLocked
                ? t('detail.assessCfTitle')
                : days == null
                  ? t('detail.cfNoDob')
                  : t('detail.cfLocked', { min: CF_MIN_AGE_DAYS, days: Math.max(1, CF_MIN_AGE_DAYS - days) });
              const openChild = () => navigate(`/mothers/${motherId}/children/${c.id}`);
              return (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={openChild}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && e.target === e.currentTarget) openChild();
                  }}
                  className="flex cursor-pointer flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-left
                             transition-colors hover:bg-surface-sunken focus-visible:outline-none
                             focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <span className="flex size-9 items-center justify-center rounded-lg bg-coral-50 text-primary dark:bg-coral-500/10">
                    <Baby className="size-4.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink">{c.child_name}</div>
                    <div className="truncate text-xs text-ink-muted">
                      {c.child_uid}
                      {c.gender ? ` · ${t(`options.gender.${c.gender}`)}` : ''}
                      {c.age_months != null ? ` · ${c.age_months} mo` : ''}
                      {c.birth_weight != null ? ` · ${c.birth_weight} kg` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5" onClick={e => e.stopPropagation()}>
                    <Button
                      size="sm"
                      variant="outline"
                      title={t('detail.assessBfTitle')}
                      onClick={e => {
                        e.stopPropagation();
                        navigate(`/mothers/${motherId}/children/${c.id}/assessments/breastfeeding`);
                      }}
                    >
                      <Heart className="size-3.5" /> {t('detail.assessBf')}
                    </Button>
                    {/* wrapper span carries the tooltip — a disabled Button swallows pointer events */}
                    <span title={cfTooltip}>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={cfLocked}
                        onClick={e => {
                          e.stopPropagation();
                          navigate(`/mothers/${motherId}/children/${c.id}/assessments/complementary_feeding`);
                        }}
                      >
                        <Utensils className="size-3.5" /> {t('detail.assessCf')}
                      </Button>
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      title={t('detail.assessCgTitle')}
                      onClick={e => {
                        e.stopPropagation();
                        navigate(`/mothers/${motherId}/children/${c.id}/assessments/growth_monitoring`);
                      }}
                    >
                      <Ruler className="size-3.5" /> {t('detail.assessCg')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      title={t('detail.growthChartTitle')}
                      onClick={e => {
                        e.stopPropagation();
                        navigate(`/growth?child=${c.id}`);
                      }}
                    >
                      <Activity className="size-3.5" /> {t('detail.growthChart')}
                    </Button>
                  </div>
                  <ChevronRight className="hidden size-4 text-ink-faint sm:block" />
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};

export default MotherDetailPage;
