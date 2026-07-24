import React from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../ui';
import type { AnswerSnapshot, FormResponseDetail } from '../../lib/flowTypes';

/**
 * Renders ONE submitted form response in full: its title, the green/red LAP
 * tallies, and every answer (measurements, feeding recall, BF/CF checkpoints …).
 * Shared by the single-visit modal and the whole-case drill-down.
 */

const verdictVariant = (verdict: string | null): 'success' | 'error' | 'neutral' => {
  if (verdict === 'green') return 'success';
  if (verdict === 'red') return 'error';
  return 'neutral';
};

export const AnswerRow: React.FC<{ answer: AnswerSnapshot }> = ({ answer }) => {
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

const ResponseDetailCard: React.FC<{ detail: FormResponseDetail }> = ({ detail }) => {
  const { t } = useTranslation('growth');
  return (
    <section className="mb-4 last:mb-0">
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
        {detail.answers_json.length === 0 && (
          <p className="py-2 text-xs text-ink-faint">{t('caseDetail.noAnswers')}</p>
        )}
      </div>
    </section>
  );
};

export default ResponseDetailCard;
