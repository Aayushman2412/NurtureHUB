import React from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, MapPin, Phone, Salad, Stethoscope } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Badge, Button } from '../ui';
import { useAuth } from '../../context/AuthContext';
import type { Mother } from '../../api/mothers';

/**
 * Summary header for a mother's page: the health worker who registered her +
 * the mother's key details, with a shortcut to the mother-level Protein Intake
 * assessment. A cleaner take on the reference "Maternal-Child Nutrition" card.
 */
interface LearnerMotherCardProps {
  mother: Mother;
  /** Show the "Protein intake" shortcut (hidden where it would be redundant). */
  showProteinAction?: boolean;
}

const Meta: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode }> = ({
  icon,
  label,
  value,
}) => (
  <div className="flex items-start gap-2">
    <span className="mt-0.5 text-ink-faint" aria-hidden>
      {icon}
    </span>
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="truncate text-sm font-semibold text-ink">{value || '—'}</div>
    </div>
  </div>
);

const LearnerMotherCard: React.FC<LearnerMotherCardProps> = ({ mother, showProteinAction = true }) => {
  const { t } = useTranslation('mother');
  const { user } = useAuth();
  const navigate = useNavigate();

  const learnerName = user?.full_name || user?.email || t('card.learnerFallback');
  const learnerRole = user?.role || '';
  const district = user?.program_district?.name || user?.district || '';

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-(--shadow-card)">
      {/* Banner: mother identity + registering health worker */}
      <div className="flex flex-wrap items-center gap-4 bg-gradient-to-br from-coral-50 to-sage-100/60 px-6 py-5 dark:from-coral-500/10 dark:to-sage-500/10">
        <Avatar name={mother.mother_name} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-xl font-extrabold text-ink">{mother.mother_name}</h2>
            <Badge variant="neutral">{mother.mother_uid}</Badge>
            {mother.gestational_weeks != null && (
              <Badge variant="info">{t('detail.weeks', { n: mother.gestational_weeks })}</Badge>
            )}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-ink-muted">
            <Stethoscope className="size-3.5 shrink-0" aria-hidden />
            <span className="font-semibold text-ink">{learnerName}</span>
            {learnerRole && <span>· {learnerRole}</span>}
            {district && <span>· {district}</span>}
          </p>
        </div>
        {showProteinAction && (
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Salad className="size-4" />}
            onClick={() => navigate(`/mothers/${mother.id}/assessments/mother_protein_intake`)}
          >
            {t('card.proteinIntake')}
          </Button>
        )}
      </div>

      {/* Mother meta strip */}
      <div className="grid grid-cols-2 gap-4 px-6 py-4 sm:grid-cols-4">
        <Meta
          icon={<CalendarClock className="size-4" />}
          label={t('card.age')}
          value={mother.mother_age ? t('detail.ageValue', { n: mother.mother_age }) : null}
        />
        <Meta icon={<MapPin className="size-4" />} label={t('card.village')} value={mother.village} />
        <Meta icon={<Phone className="size-4" />} label={t('card.mobile')} value={mother.mobile} />
        <Meta
          icon={<CalendarClock className="size-4" />}
          label={t('card.edd')}
          value={mother.edd_records || mother.edd_lmp}
        />
      </div>
    </div>
  );
};

export default LearnerMotherCard;
