import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Baby, User, ClipboardList } from 'lucide-react';
import { Modal, Spinner } from '../ui';
import { cn } from '../../utils/cn';
import {
  getGrowthCaseDetail,
  type GrowthCaseDetail,
  type GrowthSummaryRow,
  type ActivityBlock,
} from '../../api/growth';
import { formatAge } from '../../lib/growthChart';
import ResponseDetailCard from './ResponseDetailCard';

/**
 * Full case drill-down opened by clicking a summary-table row: identity, the
 * activity/outcome metrics for that case, and EVERY submitted form — child
 * responses grouped visit-by-visit plus mother-level forms — with all answers.
 */
interface Props {
  row: GrowthSummaryRow | null;
  onClose: () => void;
}

const fmtZ = (z: number | null) => (z == null ? '—' : `${z > 0 ? '+' : ''}${z.toFixed(1)}`);
const fmtMonths = (days: number | null) =>
  days == null ? '—' : days < 0 ? 'AN' : `${Math.round(days / 30.44)}m`;

const Fact: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex flex-col">
    <span className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</span>
    <span className="text-sm font-medium text-ink">{value}</span>
  </div>
);

const ActivityStat: React.FC<{ label: string; block: ActivityBlock }> = ({ label, block }) => (
  <div className="rounded-lg border border-border bg-surface px-3 py-2">
    <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
    <div className="mt-0.5 flex items-baseline gap-1 tabular-nums">
      <span className="text-lg font-bold text-ink">{block.actual}</span>
      <span className="text-xs text-ink-faint">/ {block.expected ?? '—'}</span>
      {block.actual_pct != null && (
        <span
          className={cn(
            'ml-auto text-xs font-semibold',
            block.actual_pct >= 100 ? 'text-success-600' : block.actual_pct < 50 ? 'text-coral-600' : 'text-ink-muted',
          )}
        >
          {block.actual_pct}%
        </span>
      )}
    </div>
  </div>
);

const CaseDetailModal: React.FC<Props> = ({ row, onClose }) => {
  const { t } = useTranslation('growth');
  const [detail, setDetail] = useState<GrowthCaseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [openVisits, setOpenVisits] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!row) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    setDetail(null);
    getGrowthCaseDetail(row.case_id)
      .then(d => {
        if (cancelled) return;
        setDetail(d);
        setOpenVisits(new Set(d.visits.map(v => v.date))); // everything opened by default
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [row]);

  if (!row) return null;

  const toggle = (date: string) =>
    setOpenVisits(prev => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });

  const wfaz = row.outcomes.wfaz;
  const hfaz = row.outcomes.hfaz;

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span>{row.identity.learner_name ?? t('admin.orphanLearner')}</span>
          <span className="text-ink-faint">·</span>
          <span className="text-ink-muted">{row.identity.mother_name}</span>
          <span className="text-ink-faint">·</span>
          <span className="font-mono text-sm text-ink-muted">{row.identity.child_uid}</span>
        </span>
      }
    >
      {/* identity facts */}
      <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-surface-sunken p-3 sm:grid-cols-4">
        <Fact label={t('summary.role')} value={row.identity.role_group ?? '—'} />
        <Fact label={t('filters.department')} value={row.meta.department ?? '—'} />
        <Fact label={t('caseDetail.gender')} value={detail?.child.gender ?? row.meta.sex ?? '—'} />
        <Fact label={t('caseDetail.born')} value={detail?.child.dob ?? '—'} />
        <Fact
          label={t('summary.adoptionType')}
          value={row.case_details.adoption_type ?? '—'}
        />
        <Fact label={t('summary.adoptAgeFull')} value={fmtMonths(row.case_details.age_of_adoption_days)} />
        <Fact label={t('summary.durationFull')} value={fmtMonths(row.case_details.adoption_duration_days)} />
        {detail?.mother?.village && <Fact label={t('caseDetail.village')} value={detail.mother.village} />}
      </div>

      {/* activity + outcome metrics from the row */}
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-muted">
        {t('caseDetail.metrics')}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ActivityStat label={t('summary.groups.total')} block={row.activities.total} />
        <ActivityStat label="CG" block={row.activities.cg} />
        <ActivityStat label="BF" block={row.activities.bf} />
        <ActivityStat label="CF" block={row.activities.cf} />
      </div>
      <div className="mb-5 flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-border px-3 py-2 text-sm">
        <span className="text-ink-muted">
          WFAz <span className="text-ink-faint">BV/AV/LV</span>:{' '}
          <b className="tabular-nums text-ink">{fmtZ(wfaz.bv)} / {fmtZ(wfaz.av)} / {fmtZ(wfaz.lv)}</b>
        </span>
        <span className="text-ink-muted">
          HFAz <span className="text-ink-faint">BV/AV/LV</span>:{' '}
          <b className="tabular-nums text-ink">{fmtZ(hfaz.bv)} / {fmtZ(hfaz.av)} / {fmtZ(hfaz.lv)}</b>
        </span>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-10">
          <Spinner />
        </div>
      )}
      {error && <p className="py-6 text-center text-sm text-error-600">{t('visitModal.loadError')}</p>}

      {!loading && !error && detail && (
        <>
          {/* visits */}
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-sm font-bold text-ink">
              <Baby className="size-4 text-ink-muted" />
              {t('caseDetail.visits')} ({detail.visits.length})
            </div>
            {detail.visits.length > 0 && (
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  className="text-primary-ink hover:underline"
                  onClick={() => setOpenVisits(new Set(detail.visits.map(v => v.date)))}
                >
                  {t('caseDetail.expandAll')}
                </button>
                <button
                  type="button"
                  className="text-ink-muted hover:underline"
                  onClick={() => setOpenVisits(new Set())}
                >
                  {t('caseDetail.collapseAll')}
                </button>
              </div>
            )}
          </div>

          {detail.visits.length === 0 && (
            <p className="rounded-lg border border-border px-3 py-4 text-sm text-ink-muted">
              {t('caseDetail.noVisits')}
            </p>
          )}

          <div className="space-y-2">
            {detail.visits.map(v => {
              const open = openVisits.has(v.date);
              return (
                <div key={v.date} className="overflow-hidden rounded-lg border border-border">
                  <button
                    type="button"
                    onClick={() => toggle(v.date)}
                    className="flex w-full items-center gap-2 bg-surface-sunken px-3 py-2 text-left transition-colors hover:bg-surface-sunken/70"
                  >
                    {open ? (
                      <ChevronDown className="size-4 shrink-0 text-ink-muted" />
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-ink-muted" />
                    )}
                    <span className="font-semibold text-ink">{v.date}</span>
                    {v.age_days != null && (
                      <span className="text-xs text-ink-muted">{t('tooltip.age')} {formatAge(v.age_days)}</span>
                    )}
                    <span className="ml-auto flex flex-wrap items-center gap-x-3 text-xs text-ink-muted">
                      {v.weight != null && <span>{v.weight.toFixed(2)} kg</span>}
                      {v.length != null && <span>{v.length.toFixed(1)} cm</span>}
                      <span className="rounded-full bg-surface px-2 py-0.5 font-medium">
                        {t('caseDetail.formCount', { count: v.responses.length })}
                      </span>
                    </span>
                  </button>
                  {open && (
                    <div className="px-3 py-2">
                      {v.responses.map(r => (
                        <ResponseDetailCard key={r.id} detail={r} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* mother-level forms */}
          {detail.mother_forms.length > 0 && (
            <>
              <div className="mb-2 mt-5 flex items-center gap-1.5 text-sm font-bold text-ink">
                <User className="size-4 text-ink-muted" />
                {t('caseDetail.motherForms')} ({detail.mother_forms.length})
              </div>
              <div className="rounded-lg border border-border px-3 py-2">
                {detail.mother_forms.map(r => (
                  <div key={r.id}>
                    <div className="flex items-center gap-1.5 pt-2 text-xs text-ink-faint">
                      <ClipboardList className="size-3.5" />
                      {r.assessment_date}
                    </div>
                    <ResponseDetailCard detail={r} />
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
};

export default CaseDetailModal;
