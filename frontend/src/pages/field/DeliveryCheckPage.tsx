import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Baby, ChevronRight, HeartPulse } from 'lucide-react';
import { getMother } from '../../api/mothers';
import { formRunUrl, type FormCode } from '../../api/today';
import { flowString } from '../../lib/careFlow';
import { sortForms } from '../../components/field/fieldText';
import { PageHeader } from '../../components/ui';

const ANC_FORMS = new Set<string>(['anc', 'protein']);

/**
 * "Has the delivery happened?" — asked first at every pregnancy visit from 35
 * weeks (November 2026 protocol, docs/visit-protocol-2026-11.md).
 *
 *   Yes → register the baby (child form), then the growth check,
 *         breastfeeding and the mother's protein form. No pregnancy check.
 *   No  → the pregnancy check and the protein form, as at every visit.
 */
const DeliveryCheckPage: React.FC = () => {
  const { motherId: param } = useParams();
  const motherId = Number(param);
  const [params] = useSearchParams();
  const { t } = useTranslation('dashboard');
  const [name, setName] = useState('');

  useEffect(() => {
    getMother(motherId).then(m => setName(m.mother_name)).catch(() => { /* the question stands without the name */ });
  }, [motherId]);

  // The visit's own forms for "No" (the pregnancy check and protein form).
  const asked = (params.get('forms') ?? '').split('.').filter(f => ANC_FORMS.has(f)) as FormCode[];
  const [first, ...rest] = sortForms(asked.length ? asked : ['anc', 'protein']);
  const noUrl = formRunUrl(first, motherId, null, flowString('visit', rest));
  // The child form carries on with the baby's first visit (lib/careFlow) and
  // then the mother's protein form.
  const yesUrl = `/mothers/${motherId}/children/new?flow=${flowString('visit', ['protein'])}`;

  const choice = 'flex min-h-16 items-center gap-3 px-4 py-3.5 hover:bg-surface-sunken';
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <PageHeader title={t('field.delivery.title')} description={name || undefined} backTo={`/mothers/${motherId}`} />
      <p className="text-base text-ink">{t('field.delivery.body')}</p>
      <div className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
        <Link to={yesUrl} className={choice}>
          <Baby className="size-5 shrink-0 text-primary-ink" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-ink">{t('field.delivery.yes')}</span>
            <span className="block text-sm text-ink-muted">{t('field.delivery.yesHint')}</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-ink-muted" />
        </Link>
        <Link to={noUrl} className={choice}>
          <HeartPulse className="size-5 shrink-0 text-primary-ink" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-ink">{t('field.delivery.no')}</span>
            <span className="block text-sm text-ink-muted">{t('field.delivery.noHint')}</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-ink-muted" />
        </Link>
      </div>
    </div>
  );
};

export default DeliveryCheckPage;
