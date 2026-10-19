import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { buttonClasses, EmptyState } from '../components/ui';

/**
 * Adoptions and the Growth Monitor before the learner is selected for
 * face-to-face training (review of 19 Oct 2026): say why they are closed and
 * send her back to her training.
 */
const SectionLockedPage: React.FC = () => {
  const { t } = useTranslation('app');
  return (
    <EmptyState
      icon={<Lock className="size-8" />}
      title={t('locked.title')}
      description={t('locked.body')}
      action={<Link to="/dashboard" className={buttonClasses('primary', 'md')}>{t('locked.back')}</Link>}
    />
  );
};

export default SectionLockedPage;
