import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Baby, ChevronRight, CloudUpload, Plus, Search, Users } from 'lucide-react';
import { Badge, buttonClasses, Card, EmptyState, Input, PageLoader } from '../../components/ui';
import { listMothers, type MotherListItem } from '../../api/mothers';
import { getToday, type CaseRow } from '../../api/today';
import { TONE_CLASSES } from '../../lib/babyStatus';
import { formNames, shortDay } from '../../components/field/fieldText';
import { usePendingSync } from '../../offline/usePendingSync';
import { SYNC_DONE_EVENT } from '../../offline/sync';
import { cn } from '../../utils/cn';

/** Show the search box once the list is longer than a screen. */
const SEARCH_FROM = 8;

/** One mother: her status in colour and words, her babies, the next visit. */
const CaseLine: React.FC<{ c: CaseRow; asOf: string }> = ({ c, asOf }) => {
  const { t } = useTranslation('dashboard');
  const tone = TONE_CLASSES[c.status];
  return (
    <Card className="overflow-hidden p-0">
      <Link to={`/mothers/${c.mother_id}`} className="flex items-start gap-3 p-4 hover:bg-surface-sunken/60 active:bg-surface-sunken">
        <span className={cn('mt-1.5 size-3.5 shrink-0 rounded-full', tone.dot)} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="truncate font-display text-base font-bold text-ink">{c.mother_name}</span>
            {/* Adopted in pregnancy and the baby since born: the baby says it. */}
            {c.type && c.type !== 'unknown' && !(c.type === 'anc' && c.children.length > 0) && (
              <span className="text-xs text-ink-muted">{t(`field.type.${c.type}`)}</span>
            )}
          </span>
          <span className={cn('block text-sm font-semibold', tone.text)}>
            {t(`field.rowStatus.${c.status}`)} — {t(`field.reason.${c.reason}`, { defaultValue: t('field.reason.low') })}
          </span>
          {c.next && (c.next.due_on <= asOf ? (
            <span className="block text-sm font-semibold text-ink">
              {t('field.list.nextNow', { forms: formNames(c.next.forms, t) })}
            </span>
          ) : (
            <span className="block text-sm text-ink-muted">
              {t('field.list.next', { date: shortDay(c.next.due_on), forms: formNames(c.next.forms, t) })}
            </span>
          ))}
        </span>
        <ChevronRight className="mt-1 size-5 shrink-0 text-ink-faint" />
      </Link>
      {c.children.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-border bg-surface-sunken/40 px-4 py-2.5">
          {c.children.map(k => (
            <Link
              key={k.id}
              to={`/babies/${k.id}`}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-sm font-semibold text-ink hover:border-border-strong"
            >
              <Baby className="size-4 text-ink-muted" />
              {k.name || t('field.baby')}
              <span className={cn('size-2.5 rounded-full', TONE_CLASSES[k.status].dot)} aria-hidden />
              <span className={cn('text-xs', TONE_CLASSES[k.status].text)}>{t(`field.short.${k.status}`)}</span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
};

/** Offline (or an older server): the plain list, so registration still works. */
const PlainLine: React.FC<{ m: MotherListItem }> = ({ m }) => {
  const { t } = useTranslation('dashboard');
  return (
    <Link to={`/mothers/${m.id}`} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 hover:bg-surface-sunken/60">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-base font-bold text-ink">{m.mother_name}</span>
        <span className="block text-sm text-ink-muted">
          {m.adoption_type && m.adoption_type !== 'unknown' ? t(`field.type.${m.adoption_type}`) : m.mother_uid}
        </span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-ink-faint" />
    </Link>
  );
};

/**
 * My mothers (launch review of 19 Oct 2026, Abhay: "a line list of my
 * adoptions with the status and the next visit as per the LAP protocol").
 * Red first, then yellow, then green — every colour with its word.
 */
const MothersListPage: React.FC = () => {
  const { t } = useTranslation('dashboard');
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [asOf, setAsOf] = useState('');
  const [plain, setPlain] = useState<MotherListItem[] | null>(null);
  const [query, setQuery] = useState('');
  // Registrations captured offline appear as "waiting to sync" cards until the
  // queue drains — otherwise a just-registered mother would silently vanish.
  const { items: pendingItems } = usePendingSync();
  const pendingMothers = pendingItems.filter(i => i.kind === 'mother');

  useEffect(() => {
    let alive = true;
    const load = () => getToday()
      .then(v => { if (alive) { setCases(v.cases); setAsOf(v.as_of); } })
      .catch(() => listMothers().then(m => { if (alive) setPlain(m); }).catch(() => { if (alive) setPlain([]); }));
    load();
    // Re-fetch when a sync run finishes so freshly synced mothers appear.
    window.addEventListener(SYNC_DONE_EVENT, load);
    return () => { alive = false; window.removeEventListener(SYNC_DONE_EVENT, load); };
  }, []);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (cases ?? []).filter(c => !q
    || c.mother_name.toLowerCase().includes(q)
    || c.mother_uid?.toLowerCase().includes(q)
    || c.children.some(k => (k.name || '').toLowerCase().includes(q))), [cases, q]);
  const count = cases?.length ?? plain?.length ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold text-ink">{t('field.list.title')}</h1>
        {count > 0 && <span className="text-sm font-semibold text-ink-muted">{t('field.list.count', { count })}</span>}
      </div>
      <Link to="/mothers/new" className={buttonClasses('primary', 'lg', 'w-full min-h-14')}>
        <Plus className="size-6" />{t('field.register')}
      </Link>

      {pendingMothers.map(item => (
        <Card key={item.id} className="flex items-center gap-3 border-dashed p-4">
          <CloudUpload className="size-5 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-display font-bold text-ink">
              {item.label || t('list.pendingUnnamed', { ns: 'mother', defaultValue: 'New registration' })}
            </div>
            <div className="text-xs text-ink-muted">{t('pendingSyncHint', { ns: 'offline' })}</div>
          </div>
          <Badge variant="warning">{t('pendingBadge', { ns: 'offline' })}</Badge>
        </Card>
      ))}

      {count > SEARCH_FROM && cases && (
        <div className="relative">
          <Input leftIcon={<Search />} value={query} onChange={e => setQuery(e.target.value)} placeholder={t('field.list.search')} aria-label={t('field.list.search')} />
        </div>
      )}

      {cases == null && plain == null ? (
        <PageLoader label={t('list.loading', { ns: 'mother' })} className="min-h-40" />
      ) : count === 0 ? (
        <Card className="p-2">
          <EmptyState icon={<Users />} title={t('field.list.emptyTitle')} description={t('field.list.emptyBody')} />
        </Card>
      ) : cases ? (
        <div className="flex flex-col gap-3">
          {shown.map(c => <CaseLine key={c.mother_id} c={c} asOf={asOf} />)}
          {shown.length === 0 && <p className="py-6 text-center text-sm text-ink-muted">{t('field.list.noMatch')}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {(plain ?? []).map(m => <PlainLine key={m.id} m={m} />)}
        </div>
      )}
    </div>
  );
};

export default MothersListPage;
