import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Activity, Check, ChevronRight } from 'lucide-react';
import {
  getMyBabiesGrowth, GROWTH_GROUPS,
  type GrowthBaby, type GrowthGroup, type MyBabiesGrowth as GrowthView, type Tier, type WeighedBaby,
} from '../../api/growthStatus';
import { Badge, buttonClasses, Skeleton } from '../ui';
import type { BadgeVariant } from '../ui';
import { cn } from '../../utils/cn';
import { shortDay, visitUrl } from './fieldText';

type Opened = GrowthGroup | 'unmeasured' | null;

const TIER_BADGE: Record<Tier, BadgeVariant> = { 1: 'error', 2: 'warning', 3: 'neutral' };
const TIER_RULE: Record<Tier, string> = { 1: 'border-l-error-500', 2: 'border-l-amber-500', 3: 'border-l-border-strong' };

/** The tier in words, never colour alone (DESIGN.md). */
export const TierBadge: React.FC<{ tier: Tier | null | undefined }> = ({ tier }) => {
  const { t } = useTranslation('dashboard');
  if (!tier) return null;
  return <Badge variant={TIER_BADGE[tier]}>{t(`field.tier.${tier}`)}</Badge>;
};

/** Why this baby is in this group, in words. */
const reason = (b: WeighedBaby, group: GrowthGroup, t: TFunction): string => {
  if (group === 'faltering') {
    return b.trend.rule === 'waz' && b.trend.since
      ? t('field.growth.reason.faltering.waz', { date: shortDay(b.trend.since) })
      : t(`field.growth.reason.faltering.${b.trend.rule}`, { defaultValue: t('field.growth.group.faltering') });
  }
  return t(`field.growth.reason.${group}.${b.grades[group] === 'severe' ? 'severe' : 'moderate'}`);
};

const BabyRow: React.FC<{ b: GrowthBaby; group: GrowthGroup | 'unmeasured' }> = ({ b, group }) => {
  const { t } = useTranslation('dashboard');
  const weighed = 'last_check' in b ? (b as WeighedBaby) : null;
  const tier = weighed?.priority.tier ?? null;
  const others = weighed ? weighed.groups.filter(g => g !== group) : [];
  return (
    <div className={cn('flex items-center gap-3 border-l-[3px] px-3.5 py-3', tier ? TIER_RULE[tier] : 'border-l-transparent')}>
      <Link to={`/babies/${b.child_id}`} className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-display text-base font-semibold text-ink">{b.child_name || t('field.baby')}</span>
          <TierBadge tier={tier} />
        </span>
        <span className="block text-sm font-semibold text-ink">
          {weighed && group !== 'unmeasured' ? reason(weighed, group, t) : t('field.reason.no_growth_check')}
        </span>
        {others.length > 0 && (
          <span className="block text-sm text-ink-muted">
            {t('field.growth.also', { groups: others.map(g => t(`field.growth.group.${g}`)).join(', ') })}
          </span>
        )}
        <span className="block truncate text-xs text-ink-muted">
          {[weighed ? t('field.growth.lastCheck', { date: shortDay(weighed.last_check) }) : null,
            b.mother_name ? t('field.motherIs', { mother: b.mother_name }) : null].filter(Boolean).join(' · ')}
        </span>
      </Link>
      <Link to={visitUrl(b.mother_id, b.child_id, b.forms)} className={buttonClasses('outline', 'sm', 'shrink-0')}>
        {t('field.urgent.start')}<ChevronRight className="size-4" />
      </Link>
    </div>
  );
};

/**
 * "My babies' growth" (visit protocol, Nov 2026): over the learner's own
 * babies' latest growth checks, how many are underweight, faltering, stunted
 * or wasted — each "x of y" over the babies weighed so far — and how many are
 * growing well or not yet weighed. Tapping a count lists those babies, the
 * most urgent first, each with its visit one tap away. The counts come from
 * the server (GET /api/growth/my-babies).
 */
const MyBabiesGrowth: React.FC = () => {
  const { t } = useTranslation('dashboard');
  const [view, setView] = useState<GrowthView | null>(null);
  const [failed, setFailed] = useState(false);
  const [opened, setOpened] = useState<Opened>(null);

  useEffect(() => {
    let alive = true;
    getMyBabiesGrowth().then(v => { if (alive) setView(v); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  if (failed) return <p className="text-sm text-ink-muted">{t('field.growth.loadFailed')}</p>;
  if (!view) return <Skeleton variant="block" className="h-36" />;
  if (view.measured + view.not_measured === 0) return null;

  const toggle = (g: Opened) => setOpened(o => (o === g ? null : g));
  const listed: GrowthBaby[] = opened === 'unmeasured' ? view.unmeasured
    : opened ? view.babies.filter(b => b.groups.includes(opened)) : [];
  const worst = (g: GrowthGroup): Tier | null => {
    const tiers = view.babies.filter(b => b.groups.includes(g)).map(b => b.priority.tier).filter((x): x is Tier => !!x);
    return tiers.length ? (Math.min(...tiers) as Tier) : null;
  };

  return (
    <section className="flex flex-col gap-2.5" aria-labelledby="my-babies-growth">
      <h2 id="my-babies-growth" className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
        <Activity className="size-5 text-primary-ink" />{t('field.growth.title')}
      </h2>
      <p className="text-sm text-ink-muted">{t('field.growth.subtitle')}</p>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
        {GROWTH_GROUPS.map(g => {
          const count = view.counts[g];
          const tier = worst(g);
          return (
            <button
              key={g}
              type="button"
              onClick={() => toggle(g)}
              aria-expanded={opened === g}
              aria-controls="my-babies-growth-list"
              className={cn(
                'flex min-h-16 cursor-pointer flex-col items-start gap-0.5 border-l-[3px] bg-surface px-3.5 py-3 text-left transition-colors hover:bg-surface-sunken',
                opened === g && 'bg-surface-sunken',
                count > 0 ? (tier === 1 ? 'border-l-error-500' : 'border-l-amber-500') : 'border-l-transparent',
              )}
            >
              <span className="text-sm font-medium text-ink-muted">{t(`field.growth.group.${g}`)}</span>
              <span className="font-display text-xl font-semibold tabular-nums text-ink">
                {t('field.growth.ofMeasured', { n: count, of: view.measured })}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5 font-semibold text-success-600 dark:text-success-500">
          <Check className="size-4" />{t('field.growth.growingWell', { count: view.growing_well })}
        </span>
        {view.not_measured > 0 && (
          <button
            type="button"
            onClick={() => toggle('unmeasured')}
            aria-expanded={opened === 'unmeasured'}
            aria-controls="my-babies-growth-list"
            className="min-h-11 cursor-pointer font-semibold text-primary-ink underline underline-offset-2 hover:text-primary-ink-hover"
          >
            {t('field.growth.notMeasured', { count: view.not_measured })}
          </button>
        )}
      </div>
      {opened && (
        <div id="my-babies-growth-list" className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {listed.length === 0
            ? <p className="px-4 py-3 text-sm text-ink-muted">{t('field.growth.empty')}</p>
            : listed.map(b => <BabyRow key={b.child_id} b={b} group={opened} />)}
        </div>
      )}
    </section>
  );
};

export default MyBabiesGrowth;
