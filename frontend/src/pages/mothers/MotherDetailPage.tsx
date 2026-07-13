import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, Baby, ChevronRight } from 'lucide-react';
import { Badge, Button, Card, EmptyState, PageHeader, PageLoader } from '../../components/ui';
import { useToast } from '../../context/ToastContext';
import { getMother, type Mother } from '../../api/mothers';
import { listChildren, type ChildListItem } from '../../api/children';

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex justify-between gap-4 border-b border-border py-2 text-sm last:border-b-0">
    <span className="text-ink-muted">{label}</span>
    <span className="text-right font-medium text-ink">{value ?? '—'}</span>
  </div>
);

const MotherDetailPage: React.FC = () => {
  const { id } = useParams();
  const motherId = Number(id);
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [mother, setMother] = useState<Mother | null>(null);
  const [children, setChildren] = useState<ChildListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getMother(motherId), listChildren(motherId)])
      .then(([m, kids]) => { setMother(m); setChildren(kids); })
      .catch(() => showToast('Failed to load mother', 'error'))
      .finally(() => setLoading(false));
  }, [motherId]);

  if (loading) return <PageLoader label="Loading" className="min-h-60" />;
  if (!mother) return null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={mother.mother_name}
        description={mother.mother_uid}
        backTo="/mothers"
        actions={<Badge variant="info">{mother.gestational_weeks != null ? `${mother.gestational_weeks} weeks` : 'Registered'}</Badge>}
      />

      <Card className="p-6">
        <h3 className="mb-3 font-display text-lg font-bold text-ink">Clinical</h3>
        <Row label="Age" value={mother.mother_age ? `${mother.mother_age} years` : null} />
        <Row label="Weight / Height" value={mother.weight && mother.height ? `${mother.weight} kg · ${mother.height} cm` : null} />
        <Row label="LMP" value={mother.lmp} />
        <Row label="EDD (LMP / records)" value={`${mother.edd_lmp || '—'} / ${mother.edd_records || '—'}`} />
        <Row label="Gestational age" value={mother.gestational_weeks != null ? `${mother.gestational_weeks} weeks · ${mother.gestational_months} months` : null} />
        <Row label="Mobile" value={mother.mobile} />
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-ink">
            Children {children.length > 0 && <span className="text-ink-muted">({children.length})</span>}
          </h3>
          <Button variant="secondary" onClick={() => navigate(`/mothers/${motherId}/children/new`)}>
            <Plus className="size-4" /> Add child
          </Button>
        </div>

        {children.length === 0 ? (
          <EmptyState
            icon={<Baby />}
            title="No children registered"
            description="Add a child once the baby is born — it will be linked to this mother."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {children.map(c => (
              <button
                key={c.id}
                onClick={() => navigate(`/mothers/${motherId}/children/${c.id}`)}
                className="flex items-center gap-3 rounded-lg border border-border p-3 text-left
                           transition-colors hover:bg-surface-sunken"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-coral-50 text-primary dark:bg-coral-500/10">
                  <Baby className="size-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink">{c.child_name}</div>
                  <div className="truncate text-xs text-ink-muted">
                    {c.child_uid}
                    {c.gender ? ` · ${c.gender}` : ''}
                    {c.age_months != null ? ` · ${c.age_months} mo` : ''}
                    {c.birth_weight != null ? ` · ${c.birth_weight} kg` : ''}
                  </div>
                </div>
                <ChevronRight className="size-4 text-ink-faint" />
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default MotherDetailPage;
