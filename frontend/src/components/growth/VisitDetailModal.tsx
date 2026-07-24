import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Modal, Spinner } from '../ui';
import type { FormResponseDetail } from '../../lib/flowTypes';
import { formatAge, sourceComboColor, type GrowthPoint } from '../../lib/growthChart';
import ResponseDetailCard from './ResponseDetailCard';

/**
 * Drill-down for a clicked chart point: everything recorded on that visit —
 * every form filed that day with all its answers (measurements, feeding
 * recall, BF checkpoints, CF diet …). Works for both admin and learner by
 * taking the response fetcher as a prop (they authenticate differently).
 */
interface VisitDetailModalProps {
  point: GrowthPoint | null;
  onClose: () => void;
  fetchResponse: (responseId: number) => Promise<FormResponseDetail>;
}

const FORM_ORDER = ['growth_monitoring', 'breastfeeding', 'complementary_feeding'];

const VisitDetailModal: React.FC<VisitDetailModalProps> = ({ point, onClose, fetchResponse }) => {
  const { t } = useTranslation('growth');
  const [details, setDetails] = useState<FormResponseDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const visit = point?.visit ?? null;

  useEffect(() => {
    if (!visit) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    setDetails([]);
    const ids = FORM_ORDER.filter(k => visit.forms[k] != null).map(k => visit.forms[k]);
    Promise.all(ids.map(id => fetchResponse(id)))
      .then(list => {
        if (!cancelled) setDetails(list);
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
  }, [visit, fetchResponse]);

  if (!point || !visit) return null;

  return (
    <Modal open onClose={onClose} title={t('visitModal.title')} size="lg">
      {/* visit header */}
      <div className="mb-4 rounded-lg bg-surface-sunken p-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-1.5 font-bold text-ink">
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ background: sourceComboColor(point.combo) }}
            />
            {point.case.child.name}
          </span>
          <span className="text-ink-muted">{point.case.child.uid}</span>
          <span className="text-ink-muted">
            {t('visitModal.mother')}: {point.case.mother.name}
          </span>
          <span className="text-ink-muted">
            {t('visitModal.learner')}: {point.case.learner.name ?? t('visitModal.orphanLearner')}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-muted">
          <span>{visit.date}</span>
          {visit.age_days != null && <span>{t('tooltip.age')}: {formatAge(visit.age_days)}</span>}
          {visit.weight != null && (
            <span>
              {t('tooltip.weight')}: <b className="text-ink">{visit.weight.toFixed(3)} kg</b>
            </span>
          )}
          {visit.length != null && (
            <span>
              {t('tooltip.length')}: <b className="text-ink">{visit.length.toFixed(1)} cm</b>
            </span>
          )}
          <Badge size="sm" variant="info">{t(`sources.${point.combo}`)}</Badge>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-10">
          <Spinner />
        </div>
      )}
      {error && <p className="py-6 text-center text-sm text-error-600">{t('visitModal.loadError')}</p>}

      {!loading &&
        !error &&
        details.map(detail => <ResponseDetailCard key={detail.id} detail={detail} />)}
    </Modal>
  );
};

export default VisitDetailModal;
