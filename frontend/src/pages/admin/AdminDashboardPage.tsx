import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import client from '../../api/client';
import {
  Users, Layers, Video, ClipboardList, FileText, Zap, ArrowRight, MapPin, Shield,
  Landmark, FilePenLine, Clapperboard, ClipboardCheck,
} from 'lucide-react';
import { Card, StatCard, WelcomeBanner } from '../../components/ui';

interface Stats {
  total_users: number;
  total_stages: number;
  total_tutorials: number;
  total_tests: number;
  total_form_fields: number;
  active_tests: number;
  district_name: string;
}

type Tone = 'sage' | 'coral' | 'amber';

const AdminDashboardPage: React.FC = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const navigate = useNavigate();
  const { t } = useTranslation('admin');

  const loadStats = useCallback(() => {
    const district = localStorage.getItem('nh_admin_district') || '';
    client
      .get(`/api/admin/dashboard-stats?district=${district}`)
      .then(res => setStats(res.data))
      .catch(() =>
        setStats({
          total_users: 0,
          total_stages: 0,
          total_tutorials: 0,
          total_tests: 0,
          total_form_fields: 0,
          active_tests: 0,
          district_name: '',
        }),
      );
  }, []);

  useEffect(() => {
    loadStats();
    const handleDistrictChange = () => loadStats();
    window.addEventListener('district-changed', handleDistrictChange);
    return () => window.removeEventListener('district-changed', handleDistrictChange);
  }, [loadStats]);

  const cards: { icon: React.ReactNode; label: string; value: number; tone: Tone }[] = [
    { icon: <Users />, label: t('dashboard.stats.districtUsers'), value: stats?.total_users ?? 0, tone: 'coral' },
    { icon: <Layers />, label: t('dashboard.stats.trainingStages'), value: stats?.total_stages ?? 0, tone: 'sage' },
    { icon: <Video />, label: t('dashboard.stats.tutorials'), value: stats?.total_tutorials ?? 0, tone: 'amber' },
    { icon: <ClipboardList />, label: t('dashboard.stats.assessments'), value: stats?.total_tests ?? 0, tone: 'coral' },
    { icon: <FileText />, label: t('dashboard.stats.formFields'), value: stats?.total_form_fields ?? 0, tone: 'sage' },
    { icon: <Zap />, label: t('dashboard.stats.activeTests'), value: stats?.active_tests ?? 0, tone: 'amber' },
  ];

  const quickActions = [
    { label: t('dashboard.actions.districts.label'), desc: t('dashboard.actions.districts.desc'), path: '/admin/districts', icon: Landmark },
    { label: t('dashboard.actions.form.label'), desc: t('dashboard.actions.form.desc'), path: '/admin/form-builder', icon: FilePenLine },
    { label: t('dashboard.actions.tutorials.label'), desc: t('dashboard.actions.tutorials.desc'), path: '/admin/tutorials', icon: Clapperboard },
    { label: t('dashboard.actions.tests.label'), desc: t('dashboard.actions.tests.desc'), path: '/admin/tests', icon: ClipboardCheck },
  ];

  return (
    <div className="flex flex-col gap-6">
      <WelcomeBanner
        eyebrow={t('dashboard.eyebrow')}
        title={t('dashboard.title')}
        subtitle={
          stats?.district_name ? (
            <Trans
              t={t}
              i18nKey="dashboard.subtitleDistrict"
              components={{ strong: <strong className="font-bold text-ink" /> }}
              values={{ district: stats.district_name }}
            />
          ) : (
            t('dashboard.subtitleDefault')
          )
        }
      >
        {stats?.district_name && (
          <div className="flex items-center gap-2 rounded-xl border border-coral-100 bg-coral-50 px-4 py-2.5 text-coral-700 dark:border-coral-500/20 dark:bg-coral-500/10 dark:text-coral-300">
            <MapPin className="size-4.5" />
            <span className="font-bold">{stats.district_name}</span>
          </div>
        )}
        <span className="flex size-12 items-center justify-center rounded-2xl bg-coral-50 text-coral-600 dark:bg-coral-500/10 dark:text-coral-300">
          <Shield className="size-6" />
        </span>
      </WelcomeBanner>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(card => (
          <StatCard key={card.label} icon={card.icon} label={card.label} value={card.value} tone={card.tone} />
        ))}
      </div>

      {/* Quick actions */}
      <h2 className="mt-2 font-display text-xl font-bold text-ink">{t('dashboard.quickActions')}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {quickActions.map(action => (
          <Card
            key={action.path}
            interactive
            onClick={() => navigate(action.path)}
            className="flex items-center justify-between gap-4 p-5"
          >
            <div className="flex items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-coral-50 text-coral-600 dark:bg-coral-500/10 dark:text-coral-300">
                <action.icon className="size-5.5" />
              </span>
              <div>
                <h3 className="font-display font-bold text-ink">{action.label}</h3>
                <p className="text-sm text-ink-muted">{action.desc}</p>
              </div>
            </div>
            <ArrowRight className="size-5 shrink-0 text-primary-ink" />
          </Card>
        ))}
      </div>
    </div>
  );
};

export default AdminDashboardPage;
