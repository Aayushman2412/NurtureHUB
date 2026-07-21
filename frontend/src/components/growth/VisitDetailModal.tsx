import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Modal, Spinner } from '../ui';
import type { AnswerSnapshot, FormResponseDetail } from '../../lib/flowTypes';
import { formatAge, sourceComboColor, type GrowthPoint } from '../../lib/growthChart';

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

const verdictVariant = (verdict: string | null): 'success' | 'error' | 'neutral' => {
  if (verdict === 'green') return 'success';
  if (verdict === 'red') return 'error';
  return 'neutral';
};

const AnswerRow: React.FC<{ answer: AnswerSnapshot }> = ({ answer }) => {
  // Flat scalar answers are snapshotted into BOTH `value` and `selected`
  // (same string) — show each answer once.
  const chips = answer.selected.filter(sel => sel.label !== answer.value);
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-2 last:border-b-0">
      <span className="text-xs text-ink-muted">{answer.question}</span>
      {answer.value != null && answer.value !== '' && (
        <span className="text-sm font-semibold text-ink">{answer.value}</span>
      )}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map(sel => (
            <Badge key={sel.optionId} size="sm" variant={verdictVariant(sel.verdict)}>
              {sel.label}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
};

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
        details.map(detail => (
          <section key={detail.id} className="mb-4 last:mb-0">
            <div className="mb-1 flex items-center justify-between">
              <h4 className="font-display text-sm font-bold text-ink">
                {t(`forms.${detail.form_key}`, { defaultValue: detail.form_key })}
              </h4>
              {(detail.summary_json.green > 0 || detail.summary_json.red > 0) && (
                <span className="flex gap-2 text-xs">
                  <span className="font-semibold text-success-600">
                    {detail.summary_json.green} {t('visitModal.asPerLap')}
                  </span>
                  <span className="font-semibold text-error-600">
                    {detail.summary_json.red} {t('visitModal.needAttention')}
                  </span>
                </span>
              )}
            </div>
            <div className="rounded-lg border border-border px-3">
              {detail.answers_json.map((a, i) => (
                <AnswerRow key={`${a.nodeId}-${i}`} answer={a} />
              ))}
            </div>
          </section>
        ))}
    </Modal>
  );
};

export default VisitDetailModal;
