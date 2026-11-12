import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import client from '../../api/client';
import { ChevronRight } from 'lucide-react';
import { Figures, PageHeader } from '../../components/ui';
import { getProjectSlug, PROJECT_EVENT } from '../../lib/adminProject';

interface Stats {
  total_users: number;
  total_stages: number;
  total_tutorials: number;
  total_tests: number;
  total_form_fields: number;
  active_tests: number;
  district_name: string;
}

const EMPTY: Stats = {
  total_users: 0,
  total_stages: 0,
  total_tutorials: 0,
  total_tests: 0,
  total_form_fields: 0,
  active_tests: 0,
  district_name: '',
};

const AdminDashboardPage: React.FC = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const { t } = useTranslation('admin');

  const loadStats = useCallback(() => {
    const district = getProjectSlug() ?? '';
    client
      .get(`/api/admin/dashboard-stats?district=${district}`)
      .then(res => setStats(res.data))
      .catch(() => setStats(EMPTY));
  }, []);

  useEffect(() => {
    loadStats();
    const handleDistrictChange = () => loadStats();
    window.addEventListener(PROJECT_EVENT, handleDistrictChange);
    return () => window.removeEventListener(PROJECT_EVENT, handleDistrictChange);
  }, [loadStats]);

  // A dash until the numbers arrive, so a zero always means zero.
  const n = (value: number | undefined) => (stats ? value ?? 0 : '–');

  const shortcuts = [
    { label: t('dashboard.actions.districts.label'), desc: t('dashboard.actions.districts.desc'), path: '/admin/projects' },
    { label: t('dashboard.actions.form.label'), desc: t('dashboard.actions.form.desc'), path: '/admin/form-builder' },
    { label: t('dashboard.actions.tutorials.label'), desc: t('dashboard.actions.tutorials.desc'), path: '/admin/tutorials' },
    { label: t('dashboard.actions.tests.label'), desc: t('dashboard.actions.tests.desc'), path: '/admin/tests' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className="mb-0"
        title={t('dashboard.title')}
        description={
          stats?.district_name ? (
            <Trans
              t={t}
              i18nKey="dashboard.subtitleDistrict"
              components={{ strong: <strong className="font-semibold text-ink" /> }}
              values={{ district: stats.district_name }}
            />
          ) : (
            t('dashboard.subtitleDefault')
          )
        }
      />

      <Figures
        columns={6}
        items={[
          { label: t('dashboard.stats.districtUsers'), value: n(stats?.total_users) },
          { label: t('dashboard.stats.trainingStages'), value: n(stats?.total_stages) },
          { label: t('dashboard.stats.tutorials'), value: n(stats?.total_tutorials) },
          { label: t('dashboard.stats.assessments'), value: n(stats?.total_tests) },
          { label: t('dashboard.stats.formFields'), value: n(stats?.total_form_fields) },
          { label: t('dashboard.stats.activeTests'), value: n(stats?.active_tests) },
        ]}
      />

      <section aria-labelledby="shortcuts-h" className="flex flex-col gap-2">
        <h2 id="shortcuts-h" className="text-base font-semibold text-ink">{t('dashboard.quickActions')}</h2>
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {shortcuts.map(item => (
            <li key={item.path}>
              <Link
                to={item.path}
                className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-surface-sunken"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-primary-ink">{item.label}</span>
                  <span className="block text-sm text-ink-muted">{item.desc}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default AdminDashboardPage;
