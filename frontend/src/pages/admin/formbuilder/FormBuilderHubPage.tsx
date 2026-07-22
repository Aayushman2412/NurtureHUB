import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Baby,
  Edit3,
  GraduationCap,
  Heart,
  ListChecks,
  Milk,
  Ruler,
  Salad,
  Stethoscope,
  UtensilsCrossed,
  Workflow,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { adminListForms } from '../../../api/forms';
import { FORM_KEYS } from '../../../lib/flowTypes';
import type { FormDefinitionSummary, FormKey } from '../../../lib/flowTypes';
import { Alert, Badge, Button, Card, PageHeader, Skeleton } from '../../../components/ui';
import { cn } from '../../../utils/cn';

const FORM_META: Record<FormKey, { icon: LucideIcon; blurb: string }> = {
  learner_registration: {
    icon: GraduationCap,
    blurb: 'The profile a health worker completes when joining the program.',
  },
  mother_registration: {
    icon: Heart,
    blurb: 'Details captured when a learner registers a mother they serve.',
  },
  child_registration: {
    icon: Baby,
    blurb: 'Details captured when a child is added under a registered mother.',
  },
  breastfeeding: {
    icon: Milk,
    blurb: 'The guided breastfeeding assessment — a step-by-step decision tree with coaching actions.',
  },
  complementary_feeding: {
    icon: UtensilsCrossed,
    blurb: 'The complementary-feeding assessment for children past 150 days, with coaching actions.',
  },
  growth_monitoring: {
    icon: Ruler,
    blurb: 'Measurements recorded during a growth-check visit.',
  },
  antenatal: {
    icon: Stethoscope,
    blurb: 'Antenatal visit details recorded for expectant mothers.',
  },
  mother_protein_intake: {
    icon: Salad,
    blurb: "The mother's daily protein-intake recall — food-group matrices plus info blocks, filled per visit.",
  },
};

const formatDate = (iso: string | null): string => {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? 'never'
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const FormCard: React.FC<{ summary: FormDefinitionSummary; onEdit: () => void }> = ({ summary, onEdit }) => {
  const meta = FORM_META[summary.form_key];
  const Icon = meta?.icon ?? ListChecks;
  const isFlow = summary.builder_type === 'flow';

  return (
    <Card
      interactive
      onClick={onEdit}
      className={cn(
        'relative flex flex-col overflow-hidden',
        isFlow && 'bg-gradient-to-br from-coral-50/70 via-surface to-surface dark:from-coral-500/10 dark:via-surface dark:to-surface',
      )}
    >
      {/* Gradient accent bar for the flagship canvas forms */}
      {isFlow && (
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-coral-400 via-coral-500 to-amber-500" aria-hidden />
      )}

      <div className="flex flex-1 flex-col p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <span
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-xl',
              isFlow
                ? 'bg-gradient-to-br from-coral-400 to-coral-600 text-white shadow-(--shadow-glow)'
                : 'bg-coral-50 text-primary dark:bg-coral-500/10',
            )}
          >
            <Icon className="size-5.5" />
          </span>
          {isFlow ? (
            <Badge variant="coral">
              <Workflow className="size-3" /> Canvas designer
            </Badge>
          ) : (
            <Badge variant="neutral">
              <ListChecks className="size-3" /> Field list
            </Badge>
          )}
        </div>

        <h3 className="font-display text-base font-bold text-ink">{summary.title}</h3>
        <p className="mt-1 flex-1 text-[13px] leading-relaxed text-ink-muted">{meta?.blurb}</p>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3.5">
          <div className="min-w-0 text-[11px] text-ink-faint">
            <span className="font-bold text-ink-muted">v{summary.version}</span>
            {' · '}
            {summary.node_count} {isFlow ? (summary.node_count === 1 ? 'step' : 'steps') : summary.node_count === 1 ? 'field' : 'fields'}
            {' · updated '}
            {formatDate(summary.updated_at)}
          </div>
          <Button
            size="sm"
            variant={isFlow ? 'primary' : 'outline'}
            iconLeft={<Edit3 className="size-3.5" />}
            onClick={e => {
              e.stopPropagation();
              onEdit();
            }}
          >
            Edit
          </Button>
        </div>
      </div>
    </Card>
  );
};

/** Hub listing all seven data-collection forms with a jump into each builder. */
const FormBuilderHubPage: React.FC = () => {
  const navigate = useNavigate();
  const [summaries, setSummaries] = useState<FormDefinitionSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    setSummaries(null);
    adminListForms()
      .then(data => {
        if (cancelled) return;
        // Present cards in canonical order regardless of API ordering.
        const rank = (k: string) => {
          const i = (FORM_KEYS as readonly string[]).indexOf(k);
          return i === -1 ? FORM_KEYS.length : i;
        };
        setSummaries([...data].sort((a, b) => rank(a.form_key) - rank(b.form_key)));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  const openForm = (summary: FormDefinitionSummary) =>
    navigate(`/admin/form-builder/${summary.builder_type === 'flow' ? 'flow' : 'flat'}/${summary.form_key}`);

  return (
    <div>
      <PageHeader
        title="Form Builder"
        description="Design every data-collection form learners use — registration field lists and canvas-based assessment flows. Saving publishes changes to learners immediately."
      />

      {error ? (
        <div className="space-y-4">
          <Alert variant="error" title="Could not load your forms">
            Check your connection and try again.
          </Alert>
          <Button variant="outline" onClick={() => setReloadTick(t => t + 1)}>
            Retry
          </Button>
        </div>
      ) : summaries === null ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} variant="block" className="h-52" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {summaries.map(summary => (
            <FormCard key={summary.form_key} summary={summary} onEdit={() => openForm(summary)} />
          ))}
        </div>
      )}
    </div>
  );
};

export default FormBuilderHubPage;
