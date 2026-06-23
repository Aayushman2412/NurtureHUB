import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStages } from '../api/tutorials';
import { useToast } from '../context/ToastContext';
import { Play, CheckCircle, Clock, Lock } from 'lucide-react';

interface Tutorial {
  id: number;
  stage_id: number;
  title: string;
  description: string;
  module_number: string;
  duration_minutes: number;
  video_url: string;
  gradient_colors: string;
  order_index: number;
  is_completed: boolean;
}

interface Stage {
  id: number;
  title: string;
  description: string;
  order_index: number;
  is_locked: boolean;
  tutorials_completed: number;
  total_tutorials: number;
  tutorials: Tutorial[];
}

const TutorialsPage: React.FC = () => {
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'completed' | 'uncompleted'>('all');

  const { showToast } = useToast();
  const navigate = useNavigate();

  const loadStages = async () => {
    try {
      const data = await getStages();
      setStages(data);
    } catch (err) {
      showToast('Failed to load training stages', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStages();
  }, []);

  const handleTutorialClick = (stage: Stage, tut: Tutorial) => {
    if (stage.is_locked) {
      showToast('This training phase is currently locked. Complete previous assessments first.', 'warning');
      return;
    }
    navigate(`/tutorials/${tut.id}`);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <div className="spinner">Loading training modules...</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* Search / Filter Chips Row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', gap: '8px' }} className="filter-chips">
          {(['all', 'completed', 'uncompleted'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className={`filter-chip ${filter === type ? 'active' : ''}`}
              style={{
                padding: '8px 16px',
                fontSize: '0.8125rem',
                fontWeight: 600,
                borderRadius: 'var(--radius-full)',
                border: '1px solid var(--border-color)',
                backgroundColor: filter === type ? 'var(--primary-500)' : 'var(--bg-secondary)',
                color: filter === type ? 'white' : 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)'
              }}
            >
              {type === 'all' && 'All Tutorials'}
              {type === 'completed' && 'Completed ✓'}
              {type === 'uncompleted' && 'In Progress / Uncompleted'}
            </button>
          ))}
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: 0 }}>
          {stages.reduce((acc, s) => acc + s.tutorials.length, 0)} modules in curriculum
        </p>
      </div>

      {/* Stages and Video Cards List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
        {stages.map((stage) => {
          // Filter tutorials within this stage
          const filteredTutorials = stage.tutorials.filter((t) => {
            if (filter === 'completed') return t.is_completed;
            if (filter === 'uncompleted') return !t.is_completed;
            return true;
          });

          if (filteredTutorials.length === 0 && filter !== 'all') {
            return null; // Don't show empty stage sections when filters hide everything
          }

          return (
            <div key={stage.id} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* Stage header info */}
              <div 
                style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'flex-start',
                  borderBottom: '2px solid var(--border-color-light)',
                  paddingBottom: '12px'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 className="font-display" style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                      {stage.title}
                    </h3>
                    {stage.is_locked && (
                      <span className="badge badge-error" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.6875rem' }}>
                        <Lock size={10} /> Locked
                      </span>
                    )}
                  </div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '4px', margin: 0, maxWidth: '720px', lineHeight: 1.4 }}>
                    {stage.description}
                  </p>
                </div>
                {!stage.is_locked && (
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--primary-600)', whiteSpace: 'nowrap' }}>
                    {stage.tutorials_completed} / {stage.total_tutorials} Completed
                  </span>
                )}
              </div>

              {/* Tutorials Grid */}
              {filteredTutorials.length === 0 ? (
                <div style={{ padding: '30px', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-lg)', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No modules match this filter.
                </div>
              ) : (
                <div 
                  style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', 
                    gap: '24px' 
                  }}
                >
                  {filteredTutorials.map((tut) => (
                    <div
                      key={tut.id}
                      className="card card-interactive"
                      onClick={() => handleTutorialClick(stage, tut)}
                      style={{
                        overflow: 'hidden',
                        opacity: stage.is_locked ? 0.7 : 1,
                        cursor: stage.is_locked ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        height: '100%'
                      }}
                    >
                      {/* Video card thumbnail wrapper */}
                      <div 
                        className={`bg-gradient-to-r ${tut.gradient_colors || 'from-teal-500 to-cyan-500'}`}
                        style={{ 
                          height: '160px', 
                          position: 'relative',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          background: `linear-gradient(135deg, ${tut.gradient_colors?.replace('from-', '').replace('to-', '').replace(' ', ', ')})` || 'linear-gradient(135deg, var(--primary-500), var(--primary-300))'
                        }}
                      >
                        {/* Semi-transparent play trigger overlay */}
                        <div style={{
                          backgroundColor: 'rgba(15, 23, 42, 0.4)',
                          borderRadius: '50%',
                          width: '52px',
                          height: '52px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: 'var(--shadow-md)',
                          transition: 'transform var(--transition-fast)'
                        }} className="play-icon-hover">
                          <Play size={24} style={{ marginLeft: '4px', fill: 'white', stroke: 'none' }} />
                        </div>
                        
                        {/* Module number tag */}
                        <span style={{ position: 'absolute', top: '12px', left: '12px', backgroundColor: 'rgba(15, 23, 42, 0.6)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.05em' }}>
                          {tut.module_number}
                        </span>

                        {/* Completion Badge */}
                        {tut.is_completed && (
                          <span style={{ position: 'absolute', top: '12px', right: '12px', backgroundColor: 'var(--success-500)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.6875rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <CheckCircle size={12} /> Completed
                          </span>
                        )}
                      </div>

                      {/* Video card text parameters */}
                      <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                        <div>
                          <h4 className="font-display" style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px', marginTop: 0, lineHeight: 1.3 }}>
                            {tut.title}
                          </h4>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', margin: 0, lineClamp: 2, WebkitLineClamp: 2, display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden', height: '36px', lineHeight: 1.4 }}>
                            {tut.description}
                          </p>
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '16px', borderTop: '1px solid var(--border-color-light)', paddingTop: '12px' }}>
                          <Clock size={14} />
                          <span>{tut.duration_minutes} Minutes duration</span>
                        </div>
                      </div>

                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TutorialsPage;
