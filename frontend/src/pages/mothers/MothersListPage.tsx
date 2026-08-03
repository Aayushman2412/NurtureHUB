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
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
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
        <>
        {/* Phone: one card per mother. A ten-column table on a 375px screen
            shows four columns and hides the rest behind a sideways scroll that
            nobody discovers — so below `md` the same record is stacked, with
            the whole card as the tap target. */}
        <div className="flex flex-col gap-3 md:hidden">
          {mothers.map(m => (
            <Card
              key={m.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/mothers/${m.id}`)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/mothers/${m.id}`); } }}
              className="cursor-pointer p-4 transition-colors active:bg-surface-sunken/60"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-display font-bold text-ink">{m.mother_name}</div>
                  <div className="mt-0.5 truncate font-mono text-xs text-ink-muted">{m.mother_uid}</div>
                </div>
                {m.children_count > 0
                  ? <Badge variant="success">{t('list.status.lactating')}</Badge>
                  : <Badge variant="coral">{t('list.status.pregnant')}</Badge>}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {([
                  ['age', m.mother_age != null ? String(m.mother_age) : '—'],
                  ['mobile', m.mobile || '—'],
                  ['village', m.village || '—'],
                  ['gestationalAge', m.gestational_weeks != null ? t('list.weeks', { n: m.gestational_weeks }) : '—'],
                ] as const).map(([key, value]) => (
                  <div key={key} className="min-w-0">
                    <dt className="text-[11px] uppercase tracking-wide text-ink-faint">{t(`list.table.${key}`)}</dt>
                    <dd className="truncate text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          ))}
        </div>

        <Card className="hidden overflow-x-auto p-0 md:block">
          <Table>
            <THead>
              <Tr>
                <Th>{t('list.table.motherId')}</Th><Th>{t('list.table.name')}</Th><Th>{t('list.table.age')}</Th><Th>{t('list.table.mobile')}</Th><Th>{t('list.table.village')}</Th><Th>{t('list.table.hwc')}</Th><Th>{t('list.table.gestationalAge')}</Th><Th>{t('list.table.edd')}</Th><Th>{t('list.table.status')}</Th><Th>{t('list.table.registered')}</Th>
              </Tr>
            </THead>
            <TBody>
              {mothers.map(m => (
                <Tr key={m.id} className="cursor-pointer hover:bg-surface-sunken/50" onClick={() => navigate(`/mothers/${m.id}`)}>
                  <Td className="font-mono text-xs text-ink-muted">{m.mother_uid}</Td>
                  <Td className="font-semibold text-ink">{m.mother_name}</Td>
                  <Td>{m.mother_age != null ? m.mother_age : '—'}</Td>
                  <Td>{m.mobile || '—'}</Td>
                  <Td>{m.village || '—'}</Td>
                  <Td>{m.hwc_name || '—'}</Td>
                  <Td>{m.gestational_weeks != null ? <Badge variant="info">{t('list.weeks', { n: m.gestational_weeks })}</Badge> : '—'}</Td>
                  <Td>{m.edd_records || '—'}</Td>
                  <Td>
                    {m.children_count > 0
                      ? <Badge variant="success">{t('list.status.lactating')}</Badge>
                      : <Badge variant="coral">{t('list.status.pregnant')}</Badge>}
                  </Td>
                  <Td className="text-ink-muted">{new Date(m.created_at).toLocaleDateString('en-GB')}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
        </>
      )}
    </div>
  );
};

export default MothersListPage;
