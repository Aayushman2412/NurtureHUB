import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BookOpen, CalendarRange, CalendarX2, ChartColumn, FileSpreadsheet, Gauge, HeartPulse, LayoutDashboard, Presentation,
  Settings2, TriangleAlert, Users,
} from 'lucide-react';
import { downloadMasd, getMasdProjects, getMasdReport, type MasdProject, type MasdReport } from '../../api/masd';
import { useToast } from '../../context/ToastContext';
import { getProjectSlug, onProjectChanged, setProjectSlug } from '../../lib/adminProject';
import { Button, DateInput, EmptyState, Field, PageLoader, SelectField } from '../../components/ui';
import { SubNav } from '../../components/results/InsightParts';
import MasdOverview from '../../components/masd/MasdOverview';
import MasdExpected from '../../components/masd/MasdExpected';
import MasdFlags from '../../components/masd/MasdFlags';
import MasdActivity from '../../components/masd/MasdActivity';
import MasdProgress from '../../components/masd/MasdProgress';
import MasdOutcomes from '../../components/masd/MasdOutcomes';
import MasdLearners from '../../components/masd/MasdLearners';
import MasdRules from '../../components/masd/MasdRules';
import MasdSettingsModal from '../../components/masd/MasdSettingsModal';

type View = 'overview' | 'expected' | 'activity' | 'progress' | 'outcomes' | 'flags' | 'learners' | 'rules';
const VIEWS: View[] = ['overview', 'expected', 'activity', 'progress', 'outcomes', 'flags', 'learners', 'rules'];
const VIEW_KEY = 'nh_masd_view';

const readView = (): View => {
  try {
    const v = localStorage.getItem(VIEW_KEY) as View | null;
    return v && VIEWS.includes(v) ? v : 'overview';
  } catch {
    return 'overview';
  }
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/**
 * MASD — Member Activity Summary Dashboard. The analysts' district report
 * (adoption target fulfilment, activity intensity, malnutrition outcomes vs
 * NFHS) computed live from NurtureHUB's records, with the same report as a
 * PowerPoint or Excel download.
 */
const AdminMasdPage: React.FC = () => {
  const { t } = useTranslation('masd');
  const { showToast } = useToast();
  const [projects, setProjects] = useState<MasdProject[]>([]);
  const [project, setProject] = useState<string>('');
  const [asOf, setAsOf] = useState('');
  const [compare, setCompare] = useState('');
  const [report, setReport] = useState<MasdReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [view, setViewState] = useState<View>(readView);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [downloading, setDownloading] = useState<'pptx' | 'xlsx' | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const setView = (v: View) => {
    setViewState(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode: the tab is just not remembered */ }
  };

  useEffect(() => {
    getMasdProjects()
      .then(list => {
        setProjects(list);
        const current = getProjectSlug();
        const pick = list.find(p => p.slug === current && p.f2f_learners > 0)
          ?? list.find(p => p.f2f_learners > 0) ?? list[0];
        if (pick) setProject(pick.slug);
        else setLoading(false);
      })
      .catch(() => { setFailed(true); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!project) return;
    let active = true;
    setLoading(true);
    setFailed(false);
    getMasdReport({ project, asOf: asOf || undefined, compare: compare || undefined })
      .then(r => { if (active) setReport(r); })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [project, asOf, compare, reloadKey]);

  const reload = useCallback(() => setReloadKey(k => k + 1), []);

  // Follow the project picker in the sidebar, like every other admin page.
  useEffect(() => onProjectChanged(() => {
    const slug = getProjectSlug();
    if (slug && slug !== project && projects.some(p => p.slug === slug)) {
      setProject(slug);
      setCompare('');
    }
  }), [projects, project]);

  // Picking a project here moves the sidebar too, so the two never disagree.
  const pickProject = (slug: string) => {
    setProject(slug);
    setCompare('');
    if (slug && slug !== getProjectSlug()) setProjectSlug(slug);
  };

  const download = async (fmt: 'pptx' | 'xlsx') => {
    if (!project) return;
    setDownloading(fmt);
    try {
      await downloadMasd(fmt, { project, asOf: asOf || undefined, compare: compare || undefined });
    } catch {
      showToast(t('downloadFailed'), 'error');
    } finally {
      setDownloading(null);
    }
  };

  const navItems = useMemo(() => [
    { key: 'overview', label: t('views.overview'), icon: <LayoutDashboard /> },
    { key: 'expected', label: t('views.expected'), icon: <Gauge /> },
    { key: 'activity', label: t('views.activity'), icon: <ChartColumn /> },
    { key: 'progress', label: t('views.progress'), icon: <CalendarRange /> },
    { key: 'outcomes', label: t('views.outcomes'), icon: <HeartPulse /> },
    { key: 'flags', label: t('views.flags'), icon: <CalendarX2 /> },
    { key: 'learners', label: t('views.learners'), icon: <Users /> },
    { key: 'rules', label: t('views.rules'), icon: <BookOpen /> },
  ], [t]);

  if (loading && !report) return <PageLoader label={t('loading')} />;

  const cal = report?.calendar;
  const effectiveCompare = compare || report?.comparison?.then.as_of || '';
  const namedBatches = cal ? cal.batches.filter(b => b.id != null) : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-extrabold text-ink">{t('title')}</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">{t('description')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" iconLeft={<Settings2 className="size-4" />} onClick={() => setSettingsOpen(true)} disabled={!project}>
            {t('settingsButton')}
          </Button>
          <Button variant="outline" size="sm" iconLeft={<FileSpreadsheet className="size-4" />}
            loading={downloading === 'xlsx'} disabled={!report || !!downloading} onClick={() => download('xlsx')}>
            {t('downloadXlsx')}
          </Button>
          <Button size="sm" iconLeft={<Presentation className="size-4" />}
            loading={downloading === 'pptx'} disabled={!report || !!downloading} onClick={() => download('pptx')}>
            {t('downloadPptx')}
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SelectField
            label={t('project')}
            value={project}
            onChange={pickProject}
            placeholder={t('pickProject')}
            options={projects.map(p => ({ value: p.slug, label: `${p.name} (${t('f2fCount', { count: p.f2f_learners })})` }))}
          />
          <Field label={t('asOf')}>
            <DateInput value={asOf || report?.as_of || ''} onChange={v => { setAsOf(v); setCompare(''); }} />
          </Field>
          <Field label={t('compare')}>
            <DateInput value={effectiveCompare} max={report?.as_of} onChange={setCompare} />
          </Field>
        </div>
        {cal && (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-muted">
            {namedBatches.length > 0 ? (
              <span>{t('calendar.batches', { count: namedBatches.length })}: <b className="text-ink">
                {fmtDate(namedBatches[0].end_date)} – {fmtDate(namedBatches[namedBatches.length - 1].end_date)}</b></span>
            ) : (
              <span>{t('calendar.training')}: <b className="text-ink">{fmtDate(cal.training_date)}</b></span>
            )}
            <span>{t('calendar.fu')}: <b className="text-ink">{t('calendar.fuValue', { days: cal.tranches.map(tr => tr.fu_days ?? 0).join(' · ') || 0 })}</b></span>
            <span>{t('calendar.targetsNow')}: <b className="text-ink">{t('calendar.targetsValue', {
              anc: cal.targets.now.anc, lt5: cal.targets.now.pnc_lt5, ge5: cal.targets.now.pnc_ge5, nurse: cal.targets.now.nurse,
            })}</b></span>
            {cal.inferred && (
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-500">
                <TriangleAlert className="size-3.5" />{t('calendar.inferred')}
              </span>
            )}
            {loading && <span className="text-ink-faint">{t('updating')}</span>}
          </div>
        )}
      </div>

      {failed && !report ? (
        <EmptyState
          icon={<TriangleAlert className="size-8" />}
          title={t('loadFailed')}
          action={<Button onClick={reload}>{t('retry')}</Button>}
        />
      ) : !report ? (
        <EmptyState icon={<Users className="size-8" />} title={t('noProjects')} />
      ) : report.summary.learners === 0 ? (
        <EmptyState icon={<Users className="size-8" />} title={t('noLearnersTitle')} description={t('noLearners')} />
      ) : (
        <>
          {/* Frozen at the top while the page scrolls, like every dashboard's
              controls (review of 3 Oct 2026). */}
          <div className="rounded-2xl bg-background/95 py-1 backdrop-blur sm:sticky sm:top-[3.75rem] sm:z-20 lg:top-2">
            <SubNav items={navItems} value={view} onChange={v => setView(v as View)} label={t('views.label')} />
          </div>
          {view === 'overview' && <MasdOverview report={report} onOpenLearners={() => setView('learners')} onOpenFlags={() => setView('flags')} />}
          {view === 'expected' && <MasdExpected report={report} />}
          {view === 'activity' && <MasdActivity report={report} />}
          {view === 'progress' && <MasdProgress report={report} />}
          {view === 'outcomes' && <MasdOutcomes report={report} />}
          {view === 'flags' && <MasdFlags report={report} />}
          {view === 'learners' && <MasdLearners report={report} onChanged={reload} />}
          {view === 'rules' && <MasdRules report={report} onChanged={reload} />}
        </>
      )}

      <MasdSettingsModal project={project || null} open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={reload}
        table={report?.rules.expected.table} asOf={report?.as_of} />
    </div>
  );
};

export default AdminMasdPage;
