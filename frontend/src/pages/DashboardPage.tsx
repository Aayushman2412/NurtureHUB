import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getDashboardData } from '../api/dashboard';
import { BookOpen, Award, CheckCircle2, ChevronRight, Lock, Trophy, PlayCircle } from 'lucide-react';

interface Achievement {
  id: number;
  title: string;
  description: string;
  emoji_icon: string;
  earned_at: string;
}

interface Activity {
  id: string;
  type: 'tutorial' | 'test';
  title: string;
  timestamp: string;
  status: string;
}

interface Tutorial {
  id: number;
  title: string;
  is_completed: boolean;
}

interface Stage {
  id: number;
  title: string;
  description: string;
  is_locked: boolean;
  tutorials_completed: number;
  total_tutorials: number;
  tutorials: Tutorial[];
}

interface DashboardData {
  progress_percentage: number;
  tutorials_completed: number;
  total_tutorials: number;
  tests_passed: number;
  total_tests: number;
  achievements: Achievement[];
  activities: Activity[];
  stages: Stage[];
}

const DashboardPage: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const loadDashboard = async () => {
    try {
      const res = await getDashboardData();
      setData(res);
    } catch (err) {
      showToast('Failed to load dashboard metrics', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <div className="spinner" style={{ fontSize: '1.25rem' }}>Loading metrics...</div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      
      {/* Welcome Banner */}
      <div 
        style={{ 
          background: 'linear-gradient(135deg, var(--primary-600) 0%, var(--primary-800) 100%)', 
          borderRadius: 'var(--radius-xl)', 
          padding: '30px 40px',
          color: 'white',
          boxShadow: 'var(--shadow-md)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '20px'
        }}
      >
        <div>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--primary-100)' }}>
            Welcome back, Supervisor
          </span>
          <h2 className="font-display" style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: '4px', marginBottom: '8px' }}>
            {user?.full_name || 'Healthcare Worker'} 🌱
          </h2>
          <p style={{ color: 'var(--primary-50)', margin: 0, opacity: 0.9 }}>
            You have completed {data.tutorials_completed} of {data.total_tutorials} video lessons. Keep up the good work!
          </p>
        </div>
        
        {/* Progress circle metric */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ position: 'relative', width: '80px', height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {/* SVG Circle track */}
            <svg style={{ position: 'absolute', transform: 'rotate(-90deg)', width: '100%', height: '100%' }}>
              <circle cx="40" cy="40" r="32" stroke="rgba(255,255,255,0.15)" strokeWidth="6" fill="transparent" />
              <circle cx="40" cy="40" r="32" stroke="white" strokeWidth="6" fill="transparent" 
                strokeDasharray={`${2 * Math.PI * 32}`} 
                strokeDashoffset={`${2 * Math.PI * 32 * (1 - data.progress_percentage / 100)}`} 
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset var(--transition-slow)' }}
              />
            </svg>
            <span style={{ fontSize: '1.125rem', fontWeight: 800 }}>{Math.round(data.progress_percentage)}%</span>
          </div>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--primary-50)' }}>Overall<br />Progress</span>
        </div>
      </div>

      {/* Metrics Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-6)' }}>
        
        <div className="card" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--primary-50)', color: 'var(--primary-600)', borderRadius: '12px', padding: '16px', display: 'flex' }}>
            <BookOpen size={28} />
          </div>
          <div>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', display: 'block', fontWeight: 500 }}>Completed Tutorials</span>
            <span className="font-display" style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              {data.tutorials_completed} <span style={{ fontSize: '1rem', color: 'var(--text-muted)', fontWeight: 500 }}>/ {data.total_tutorials}</span>
            </span>
          </div>
        </div>

        <div className="card" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--accent-50)', color: 'var(--accent-600)', borderRadius: '12px', padding: '16px', display: 'flex' }}>
            <Award size={28} />
          </div>
          <div>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', display: 'block', fontWeight: 500 }}>Assessments Passed</span>
            <span className="font-display" style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              {data.tests_passed} <span style={{ fontSize: '1rem', color: 'var(--text-muted)', fontWeight: 500 }}>/ {data.total_tests}</span>
            </span>
          </div>
        </div>

        <div className="card" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--success-50)', color: 'var(--success-500)', borderRadius: '12px', padding: '16px', display: 'flex' }}>
            <Trophy size={28} />
          </div>
          <div>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', display: 'block', fontWeight: 500 }}>Achievements Earned</span>
            <span className="font-display" style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              {data.achievements.length} <span style={{ fontSize: '1rem', color: 'var(--text-muted)', fontWeight: 500 }}>/ 3</span>
            </span>
          </div>
        </div>
      </div>

      {/* Main Grid: Stages list & Activity/Achievements panel */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-6)', alignItems: 'flex-start', flexWrap: 'wrap' }} className="dashboard-grid">
        
        {/* Course progression pipeline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <h3 className="font-display" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Training Progression Timeline
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {data.stages.map((stg, i) => (
              <div 
                key={stg.id} 
                className={`card ${stg.is_locked ? 'card-locked' : ''}`} 
                style={{ 
                  padding: '24px', 
                  position: 'relative',
                  borderLeft: `4px solid ${stg.is_locked ? 'var(--gray-300)' : 'var(--primary-500)'}`,
                  opacity: stg.is_locked ? 0.75 : 1
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '8px' }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--primary-500)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Phase {i + 1}
                    </span>
                    <h4 className="font-display" style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px', marginBottom: '6px' }}>
                      {stg.title}
                    </h4>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0, lineHeight: 1.4 }}>
                      {stg.description}
                    </p>
                  </div>
                  {stg.is_locked ? (
                    <span className="badge badge-error" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Lock size={12} /> Locked
                    </span>
                  ) : (
                    <span className="badge badge-success">Unlocked</span>
                  )}
                </div>

                {/* Progress bars */}
                {!stg.is_locked && (
                  <div style={{ marginTop: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                      <span>Tutorial Completed: {stg.tutorials_completed} of {stg.total_tutorials}</span>
                      <span>{Math.round((stg.tutorials_completed / stg.total_tutorials) * 100)}%</span>
                    </div>
                    <div className="progress-bar" style={{ height: '8px', backgroundColor: 'var(--gray-100)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div 
                        className="progress-bar-fill" 
                        style={{ 
                          width: `${(stg.tutorials_completed / stg.total_tutorials) * 100}%`, 
                          height: '100%', 
                          backgroundColor: 'var(--primary-500)',
                          borderRadius: '4px',
                          transition: 'width var(--transition-base)' 
                        }} 
                      />
                    </div>
                  </div>
                )}

                {/* Bottom Resume Action */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                  {stg.is_locked ? (
                    <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      Complete previous assessments to unlock this phase.
                    </span>
                  ) : (
                    <button 
                      className="btn btn-primary"
                      onClick={() => navigate('/tutorials')}
                      style={{ padding: '6px 16px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem' }}
                    >
                      <PlayCircle size={16} />
                      <span>Resume Course</span>
                      <ChevronRight size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Achievements and Activity Feed */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          
          {/* Achievements Container */}
          <div className="card" style={{ padding: '24px' }}>
            <h3 className="font-display" style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Trophy size={18} style={{ color: 'var(--accent-500)' }} />
              <span>Earned Badges</span>
            </h3>

            {data.achievements.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0, textAlign: 'center', padding: '16px 0' }}>
                Complete courses & assessments to unlock achievements.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {data.achievements.map((ach) => (
                  <div key={ach.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-md)' }}>
                    <span style={{ fontSize: '1.75rem' }}>{ach.emoji_icon}</span>
                    <div>
                      <h4 style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{ach.title}</h4>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>{ach.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Activity Feed Container */}
          <div className="card" style={{ padding: '24px' }}>
            <h3 className="font-display" style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckCircle2 size={18} style={{ color: 'var(--primary-500)' }} />
              <span>Recent Activity</span>
            </h3>

            {data.activities.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0, textAlign: 'center', padding: '16px 0' }}>
                No recent activity.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative' }}>
                {data.activities.map((act, index) => (
                  <div key={act.id} style={{ display: 'flex', gap: '12px', fontSize: '0.8125rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div 
                        style={{ 
                          width: '10px', 
                          height: '10px', 
                          borderRadius: '50%', 
                          backgroundColor: act.type === 'test' ? 'var(--accent-500)' : 'var(--primary-500)',
                          marginTop: '4px' 
                        }} 
                      />
                      {index < data.activities.length - 1 && (
                        <div style={{ width: '2px', flex: 1, backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{act.title}</h4>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', marginTop: '2px' }}>
                        <span>Status: {act.status}</span>
                        <span>{new Date(act.timestamp).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

      </div>

    </div>
  );
};

export default DashboardPage;
