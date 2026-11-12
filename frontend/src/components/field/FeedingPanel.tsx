import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { confirmDropOut, recordCounselling, type ChildVisitPlan } from '../../api/visits';
import { Button, Card, Modal } from '../ui';
import { shortDay } from './fieldText';

/**
 * The mother not breastfeeding (November 2026 protocol, breastfeeding rule
 * 6): counsel her to restart; if she is still not breastfeeding at two visits
 * after the counselling, the learner may confirm the adoption a drop-out.
 * A confirmed drop-out is shown here with its date and who confirmed it.
 */
const FeedingPanel: React.FC<{ plan: ChildVisitPlan; childId: number; motherName: string;
  onChange: (plan: ChildVisitPlan) => void; }> = ({ plan, childId, motherName, onChange }) => {
  const { t } = useTranslation('dashboard');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const feeding = plan.feeding;

  const run = async (action: () => Promise<ChildVisitPlan>) => {
    setSaving(true);
    setFailed(false);
    try {
      onChange(await action());
      setConfirming(false);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  if (plan.dropout) {
    return (
      <Card className="flex flex-col gap-1 p-4">
        <p className="font-display text-base font-semibold text-ink">
          {t('field.protocol.droppedOut', { date: shortDay(plan.dropout.on) })}
        </p>
        <p className="text-sm text-ink-muted">
          {plan.dropout.by ? t('field.protocol.droppedOutBy', { name: plan.dropout.by }) : t('field.protocol.droppedOutBody')}
        </p>
      </Card>
    );
  }
  if (!feeding || feeding.state === 'ok' || feeding.state === 'not_applicable') return null;

  const error = failed ? <p className="text-sm text-error-600">{t('field.protocol.failed')}</p> : null;
  if (feeding.state === 'not_breastfeeding') {
    return (
      <Card accent="warning" className="p-4">
        <p className="text-sm font-semibold text-ink">{t('field.protocol.notBreastfeeding')}</p>
      </Card>
    );
  }
  if (feeding.state === 'counsel') {
    return (
      <Card accent="warning" className="flex flex-col gap-3 p-4">
        <div>
          <p className="font-display text-base font-semibold text-ink">{t('field.protocol.counsel.title')}</p>
          <p className="mt-1 text-sm text-ink">{t('field.protocol.counsel.body')}</p>
        </div>
        <Button variant="secondary" loading={saving} onClick={() => void run(() => recordCounselling(childId))}>
          {t('field.protocol.counsel.done')}
        </Button>
        {error}
      </Card>
    );
  }
  if (feeding.state === 'counselled') {
    return (
      <Card accent="warning" className="flex flex-col gap-1 p-4">
        <p className="font-display text-base font-semibold text-ink">
          {t('field.protocol.counselled.title', { date: feeding.counselled_on ? shortDay(feeding.counselled_on) : '' })}
        </p>
        <p className="text-sm text-ink">{t('field.protocol.counselled.body', { count: feeding.visits_after })}</p>
      </Card>
    );
  }
  return (
    <Card accent="danger" className="flex flex-col gap-3 p-4">
      <div>
        <p className="font-display text-base font-semibold text-ink">{t('field.protocol.dropOut.title')}</p>
        <p className="mt-1 text-sm text-ink">{t('field.protocol.dropOut.body')}</p>
      </div>
      <Button variant="danger" onClick={() => setConfirming(true)}>{t('field.protocol.dropOut.button')}</Button>
      {error}
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        size="sm"
        title={t('field.protocol.dropOut.confirmTitle')}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>{t('field.protocol.dropOut.cancel')}</Button>
            <Button variant="danger" loading={saving} onClick={() => void run(() => confirmDropOut(childId))}>
              {t('field.protocol.dropOut.confirm')}
            </Button>
          </>
        )}
      >
        <p className="text-sm text-ink">{t('field.protocol.dropOut.confirmBody', { mother: motherName })}</p>
        {error}
      </Modal>
    </Card>
  );
};

export default FeedingPanel;
