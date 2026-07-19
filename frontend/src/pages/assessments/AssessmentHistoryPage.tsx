import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  CalendarDays,
  ClipboardList,
  Lock,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  PageLoader,
} from '../../components/ui';
import { useToast } from '../../context/ToastContext';
import { getChild, type Child } from '../../api/children';
import { deleteResponse, getFormDefinition, listChildResponses } from '../../api/forms';
import type { FormDefinition, FormKey, FormResponseListItem } from '../../lib/flowTypes';
import { CF_MIN_AGE_DAYS, isFlowFormKey } from '../../lib/flowTypes';
import ChildChip from '../../components/assessments/ChildChip';
import TrendStrip from '../../components/assessments/TrendStrip';
import { formatDisplayDate } from '../../components/assessments/flowRunner';

const AssessmentHistoryPage: React.FC = () => {
  const { motherId: motherParam, childId: childParam, formKey: keyParam } = useParams();
  const motherId = Number(motherParam);
  const childId = Number(childParam);
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('assessments');
  const { showToast } = useToast();

  const validKey = isFlowFormKey(keyParam ?? '');
  const formKey = (keyParam ?? 'breastfeeding') as FormKey;

  const [child, setChild] = useState<Child | null>(null);
  const [definition, setDefinition] = useState<FormDefinition | null>(null);
  const [responses, setResponses] = useState<FormResponseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FormResponseListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const backTo = `/mothers/${motherId}`;
  const runUrl = `/mothers/${motherId}/children/${childId}/assessments/${formKey}/run`;

  useEffect(() => {
    if (!validKey) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    Promise.all([
      getChild(motherId, childId),
      getFormDefinition(formKey),
      listChildResponses(formKey, childId),
    ])
      .then(([c, d, r]) => {
        if (cancelled) return;
        setChild(c);
        setDefinition(d);
        setResponses(r);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [motherId, childId, formKey, validKey]);

  // Newest first for the list; oldest first for the trend strip.
  const sorted = useMemo(
    () =>
      [...responses].sort((a, b) =>
        (b.assessment_date || b.created_at).localeCompare(a.assessment_date || a.created_at),
      ),
    [responses],
  );
  const submittedAsc = useMemo(
    () => [...sorted].filter(r => r.status === 'submitted').reverse(),
    [sorted],
  );

  if (!validKey) return <Navigate to={backTo} replace />;
  if (loading) return <PageLoader label={t('common.loading')} className="min-h-60" />;

  if (loadError || !child || !definition) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Alert variant="error" title={t('common.loadFailedTitle')}>
          {t('common.loadFailedBody')}
        </Alert>
        <div>
          <Button variant="outline" onClick={() => navigate(backTo)}>
            {t('common.back')}
          </Button>
        </div>
      </div>
    );
  }

  const cfLocked =
    formKey === 'complementary_feeding' &&
    (child.age_days == null || child.age_days < CF_MIN_AGE_DAYS);
  const cfRemaining =
    child.age_days == null ? null : Math.max(1, CF_MIN_AGE_DAYS - child.age_days);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteResponse(deleteTarget.id);
      setResponses(prev => prev.filter(r => r.id !== deleteTarget.id));
      showToast(t('history.deleted'), 'success');
      setDeleteTarget(null);
    } catch {
      showToast(t('history.deleteFailed'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={definition.title}
        backTo={backTo}
        description={
          <ChildChip
            name={child.child_name}
            uid={child.child_uid}
            ageDays={child.age_days}
            ageMonths={child.age_months}
            className="mt-1"
          />
        }
        actions={
          !cfLocked && (
            <Button onClick={() => navigate(runUrl)} iconLeft={<Plus className="size-4" />}>
              {t('history.startNew')}
            </Button>
          )
        }
      />

      {cfLocked ? (
        <Card className="p-8 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-500">
            <Lock className="size-6" aria-hidden />
          </div>
          <h3 className="mt-4 font-display text-lg font-bold text-ink">{t('history.lockedTitle')}</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
            {child.age_days == null
              ? t('history.lockedNoDob', { min: CF_MIN_AGE_DAYS })
              : t('history.lockedBody', { min: CF_MIN_AGE_DAYS })}
          </p>
          {cfRemaining != null && (
            <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3.5 py-1.5 text-sm font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-500">
              <CalendarDays className="size-4" aria-hidden />
              {t('history.lockedRemaining', { days: cfRemaining })}
            </span>
          )}
        </Card>
      ) : (
        <>
          <TrendStrip items={submittedAsc} />

          {sorted.length === 0 ? (
            <EmptyState
              icon={<ClipboardList />}
              title={t('history.emptyTitle')}
              description={t('history.emptyBody', { name: child.child_name })}
              action={
                <Button onClick={() => navigate(runUrl)} iconLeft={<Plus className="size-4" />}>
                  {t('history.startNew')}
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-3">
              <h3 className="font-display text-sm font-bold uppercase tracking-wider text-ink-muted">
                {t('history.responsesTitle')}
              </h3>
              {sorted.map(r => {
                const summary = r.summary_json;
                const submitted = r.status === 'submitted';
                return (
                  <Card key={r.id} className="p-4 sm:p-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-coral-50 text-primary dark:bg-coral-500/10">
                        <CalendarDays className="size-5" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-ink">
                            {formatDisplayDate(r.assessment_date, i18n.language)}
                          </span>
                          <Badge variant={submitted ? 'success' : 'warning'}>
                            {submitted ? t('common.submitted') : t('common.draft')}
                          </Badge>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {submitted ? (
                            <>
                              <span className="inline-flex items-center rounded-full bg-success-50 px-2.5 py-0.5 text-[11px] font-semibold text-success-600 dark:bg-success-500/15 dark:text-success-500">
                                {t('history.chipGreen', { n: summary?.green ?? 0 })}
                              </span>
                              {(summary?.red ?? 0) > 0 && (
                                <span className="inline-flex items-center rounded-full bg-error-50 px-2.5 py-0.5 text-[11px] font-semibold text-error-600 dark:bg-error-500/15 dark:text-error-500">
                                  {t('history.chipRed', { n: summary?.red ?? 0 })}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-surface-sunken px-2.5 py-0.5 text-[11px] font-semibold text-ink-muted">
                              {t('history.chipDraftProgress', {
                                answered: summary?.answered ?? 0,
                                total: summary?.total ?? 0,
                              })}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {submitted ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`/assessments/${r.id}/plan`)}
                            iconRight={<ArrowRight className="size-3.5" />}
                          >
                            {t('history.viewPlan')}
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              onClick={() => navigate(`${runUrl}?responseId=${r.id}`)}
                              iconLeft={<Play className="size-3.5" />}
                            >
                              {t('history.continue')}
                            </Button>
                            <button
                              type="button"
                              aria-label={t('history.deleteDraft')}
                              title={t('history.deleteDraft')}
                              onClick={() => setDeleteTarget(r)}
                              className="cursor-pointer rounded-md p-2 text-ink-faint transition-colors hover:bg-error-50 hover:text-error-500 dark:hover:bg-error-500/10"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      <Modal
        open={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        title={t('history.deleteTitle')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={deleting} onClick={confirmDelete}>
              {t('history.deleteConfirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          {t('history.deleteBody', {
            date: formatDisplayDate(deleteTarget?.assessment_date, i18n.language),
          })}
        </p>
      </Modal>
    </div>
  );
};

export default AssessmentHistoryPage;
