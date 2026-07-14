import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Users } from 'lucide-react';
import { Badge, Button, Card, EmptyState, PageHeader, PageLoader, Table, TBody, Td, Th, THead, Tr } from '../../components/ui';
import { useToast } from '../../context/ToastContext';
import { listMothers, type MotherListItem } from '../../api/mothers';

const MothersListPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation('mother');
  const { showToast } = useToast();
  const [mothers, setMothers] = useState<MotherListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listMothers()
      .then(setMothers)
      .catch(() => showToast(t('list.loadFailed'), 'error'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={t('list.title')}
        description={t('list.description')}
        actions={<Button onClick={() => navigate('/mothers/new')}><Plus className="size-4" /> {t('list.register')}</Button>}
      />

      {loading ? (
        <PageLoader label={t('list.loading')} className="min-h-40" />
      ) : mothers.length === 0 ? (
        <Card className="p-2">
          <EmptyState
            icon={<Users />}
            title={t('list.emptyTitle')}
            description={t('list.emptyBody')}
            action={<Button onClick={() => navigate('/mothers/new')}><Plus className="size-4" /> {t('list.register')}</Button>}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <THead>
              <Tr>
                <Th>{t('list.table.motherId')}</Th><Th>{t('list.table.name')}</Th><Th>{t('list.table.village')}</Th><Th>{t('list.table.gestationalAge')}</Th><Th>{t('list.table.edd')}</Th>
              </Tr>
            </THead>
            <TBody>
              {mothers.map(m => (
                <Tr key={m.id} className="cursor-pointer hover:bg-surface-sunken/50" onClick={() => navigate(`/mothers/${m.id}`)}>
                  <Td className="font-mono text-xs text-ink-muted">{m.mother_uid}</Td>
                  <Td className="font-semibold text-ink">{m.mother_name}</Td>
                  <Td>{m.village || '—'}</Td>
                  <Td>{m.gestational_weeks != null ? <Badge variant="info">{t('list.weeks', { n: m.gestational_weeks })}</Badge> : '—'}</Td>
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
