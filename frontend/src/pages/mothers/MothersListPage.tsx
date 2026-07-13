import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Users } from 'lucide-react';
import { Badge, Button, Card, EmptyState, PageHeader, PageLoader, Table, TBody, Td, Th, THead, Tr } from '../../components/ui';
import { useToast } from '../../context/ToastContext';
import { listMothers, type MotherListItem } from '../../api/mothers';

const MothersListPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [mothers, setMothers] = useState<MotherListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listMothers()
      .then(setMothers)
      .catch(() => showToast('Failed to load mothers', 'error'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="My Mothers"
        description="Mothers you have registered into the program."
        actions={<Button onClick={() => navigate('/mothers/new')}><Plus className="size-4" /> Register mother</Button>}
      />

      {loading ? (
        <PageLoader label="Loading mothers" className="min-h-40" />
      ) : mothers.length === 0 ? (
        <Card className="p-2">
          <EmptyState
            icon={<Users />}
            title="No mothers registered yet"
            description="Register the first mother you're tracking to start collecting her records."
            action={<Button onClick={() => navigate('/mothers/new')}><Plus className="size-4" /> Register mother</Button>}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <THead>
              <Tr>
                <Th>Mother ID</Th><Th>Name</Th><Th>Village</Th><Th>Gestational age</Th><Th>EDD</Th>
              </Tr>
            </THead>
            <TBody>
              {mothers.map(m => (
                <Tr key={m.id} className="cursor-pointer hover:bg-surface-sunken/50" onClick={() => navigate(`/mothers/${m.id}`)}>
                  <Td className="font-mono text-xs text-ink-muted">{m.mother_uid}</Td>
                  <Td className="font-semibold text-ink">{m.mother_name}</Td>
                  <Td>{m.village || '—'}</Td>
                  <Td>{m.gestational_weeks != null ? <Badge variant="info">{m.gestational_weeks} weeks</Badge> : '—'}</Td>
                  <Td>{m.edd_records || '—'}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
};

export default MothersListPage;
