import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../../api/client';
import { Users, Layers, Video, ClipboardList, FileText, Zap, ArrowRight, MapPin } from 'lucide-react';

interface Stats {
  total_users: number;
  total_stages: number;
  total_tutorials: number;
  total_tests: number;
  total_form_fields: number;
  active_tests: number;
  district_name: string;
}

const AdminDashboardPage: React.FC = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const navigate = useNavigate();

  const loadStats = useCallback(() => {
    const district = localStorage.getItem('nh_admin_district') || '';
    client.get(`/api/admin/dashboard-stats?district=${district}`)
      .then(res => setStats(res.data))
      .catch(() => setStats({ total_users: 0, total_stages: 0, total_tutorials: 0, total_tests: 0, total_form_fields: 0, active_tests: 0, district_name: '' }));
  }, []);

  useEffect(() => {
    loadStats();
    const handleDistrictChange = () => loadStats();
    window.addEventListener('district-changed', handleDistrictChange);
    return () => window.removeEventListener('district-changed', handleDistrictChange);
  }, [loadStats]);

  const cards = [
    { icon: Users, label: 'District Users', value: stats?.total_users ?? 0, color: '#6366f1', bg: 'rgba(99,102,241,0.12)' },
    { icon: Layers, label: 'Training Stages', value: stats?.total_stages ?? 0, color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
    { icon: Video, label: 'Tutorials', value: stats?.total_tutorials ?? 0, color: '#06b6d4', bg: 'rgba(6,182,212,0.12)' },
    { icon: ClipboardList, label: 'Assessments', value: stats?.total_tests ?? 0, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    { icon: FileText, label: 'Form Fields', value: stats?.total_form_fields ?? 0, color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
    { icon: Zap, label: 'Active Tests', value: stats?.active_tests ?? 0, color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  ];

  const quickActions = [
    { label: 'Manage Districts', desc: 'Add, edit, or remove program districts', path: '/admin/districts', color: '#a78bfa', icon: '🏛️' },
    { label: 'Configure Registration Form', desc: 'Add, remove, or reorder registration fields', path: '/admin/form-builder', color: '#6366f1', icon: '📝' },
    { label: 'Manage Tutorials & Stages', desc: 'Upload YouTube videos, clip sections, manage stages', path: '/admin/tutorials', color: '#8b5cf6', icon: '🎬' },
    { label: 'Test Manager', desc: 'Upload questions, start/stop tests, download results', path: '/admin/tests', color: '#f59e0b', icon: '📋' },
  ];

  return (
    <div className="admin-page">
      {/* Header Banner */}
      <div className="admin-welcome-banner">
        <div>
          <span className="admin-welcome-label">Welcome back</span>
          <h1 className="admin-welcome-title">Admin Dashboard</h1>
          <p className="admin-welcome-desc">
            {stats?.district_name ? (
              <>Managing <strong style={{ color: '#c4b5fd' }}>{stats.district_name}</strong> district — configure forms, upload tutorials, and control assessments.</>
            ) : (
              'Manage your platform from here — configure forms, upload tutorials, and control assessments.'
            )}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {stats?.district_name && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px',
              background: 'rgba(139,92,246,0.15)', borderRadius: '12px', border: '1px solid rgba(139,92,246,0.3)',
            }}>
              <MapPin size={18} style={{ color: '#c4b5fd' }} />
              <span style={{ fontWeight: 700, fontSize: '1rem', color: '#c4b5fd' }}>{stats.district_name}</span>
            </div>
          )}
          <div className="admin-welcome-icon">🛡️</div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="admin-stats-grid">
        {cards.map(card => (
          <div key={card.label} className="admin-stat-card">
            <div className="admin-stat-icon" style={{ backgroundColor: card.bg, color: card.color }}>
              <card.icon size={24} />
            </div>
            <div>
              <span className="admin-stat-value">{card.value}</span>
              <span className="admin-stat-label">{card.label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <h2 className="admin-section-title">Quick Actions</h2>
      <div className="admin-actions-grid">
        {quickActions.map(action => (
          <button
            key={action.path}
            className="admin-action-card"
            onClick={() => navigate(action.path)}
          >
            <div>
              <h3 className="admin-action-title">{action.label}</h3>
              <p className="admin-action-desc">{action.desc}</p>
            </div>
            <ArrowRight size={20} style={{ color: action.color, flexShrink: 0 }} />
          </button>
        ))}
      </div>
    </div>
  );
};

export default AdminDashboardPage;
