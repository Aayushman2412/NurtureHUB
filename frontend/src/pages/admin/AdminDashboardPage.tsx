import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../../api/client';
import { Users, Layers, Video, ClipboardList, FileText, Zap, ArrowRight, MapPin, Shield } from 'lucide-react';
import { Card, StatCard } from '../../components/ui';

interface Stats {
  total_users: number;
  total_stages: number;
  total_tutorials: number;
  total_tests: number;
  total_form_fields: number;
  active_tests: number;
  district_name: string;
}

type Tone = 'teal' | 'sage' | 'coral' | 'amber';

const AdminDashboardPage: React.FC = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const navigate = useNavigate();

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
    { icon: <Users />, label: 'District Users', value: stats?.total_users ?? 0, tone: 'teal' },
    { icon: <Layers />, label: 'Training Stages', value: stats?.total_stages ?? 0, tone: 'sage' },
    { icon: <Video />, label: 'Tutorials', value: stats?.total_tutorials ?? 0, tone: 'teal' },
    { icon: <ClipboardList />, label: 'Assessments', value: stats?.total_tests ?? 0, tone: 'amber' },
    { icon: <FileText />, label: 'Form Fields', value: stats?.total_form_fields ?? 0, tone: 'sage' },
    { icon: <Zap />, label: 'Active Tests', value: stats?.active_tests ?? 0, tone: 'coral' },
  ];

  const quickActions = [
    { label: 'Manage Districts', desc: 'Add, edit, or remove program districts', path: '/admin/districts', icon: '🏛️' },
    { label: 'Configure Registration Form', desc: 'Add, remove, or reorder registration fields', path: '/admin/form-builder', icon: '📝' },
    { label: 'Manage Tutorials & Stages', desc: 'Upload YouTube videos, clip sections, manage stages', path: '/admin/tutorials', icon: '🎬' },
    { label: 'Test Manager', desc: 'Upload questions, start/stop tests, download results', path: '/admin/tests', icon: '📋' },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Banner — teal identity for admin */}
      <div className="relative flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-3xl bg-gradient-to-br from-teal-500 via-teal-600 to-teal-800 px-8 py-8 text-white shadow-(--shadow-card-hover)">
        <div className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-white/15 blur-2xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-28 left-1/3 size-64 rounded-full bg-teal-900/30 blur-3xl" aria-hidden />
        <div className="relative">
          <span className="text-xs font-bold uppercase tracking-widest text-white/75">Welcome back</span>
          <h1 className="mt-1.5 mb-2 font-display text-3xl font-extrabold text-white drop-shadow-sm">Admin Dashboard</h1>
          <p className="max-w-xl text-[15px] text-white/85">
            {stats?.district_name ? (
              <>
                Managing <strong className="text-white">{stats.district_name}</strong> district — configure forms,
                upload tutorials, and control assessments.
              </>
            ) : (
              'Manage your platform from here — configure forms, upload tutorials, and control assessments.'
            )}
          </p>
        </div>
        <div className="relative flex items-center gap-3">
          {stats?.district_name && (
            <div className="flex items-center gap-2 rounded-xl border border-white/25 bg-white/15 px-4 py-2.5">
              <MapPin className="size-4.5" />
              <span className="font-bold">{stats.district_name}</span>
            </div>
          )}
          <span className="flex size-12 items-center justify-center rounded-2xl bg-white/15">
            <Shield className="size-6" />
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(card => (
          <StatCard key={card.label} icon={card.icon} label={card.label} value={card.value} tone={card.tone} />
        ))}
      </div>

      {/* Quick actions */}
      <h2 className="mt-2 font-display text-xl font-bold text-ink">Quick Actions</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {quickActions.map(action => (
          <Card
            key={action.path}
            interactive
            onClick={() => navigate(action.path)}
            className="flex items-center justify-between gap-4 p-5"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">{action.icon}</span>
              <div>
                <h3 className="font-display font-bold text-ink">{action.label}</h3>
                <p className="text-sm text-ink-muted">{action.desc}</p>
              </div>
            </div>
            <ArrowRight className="size-5 shrink-0 text-teal-600 dark:text-teal-300" />
          </Card>
        ))}
      </div>
    </div>
  );
};

export default AdminDashboardPage;
