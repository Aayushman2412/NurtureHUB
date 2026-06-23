import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getStages, completeTutorial } from '../api/tutorials';
import { useToast } from '../context/ToastContext';
import { Play, CheckCircle, Clock, ChevronLeft, Check, Lock } from 'lucide-react';

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

const TutorialPlayerPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [stages, setStages] = useState<Stage[]>([]);
  const [currentTutorial, setCurrentTutorial] = useState<Tutorial | null>(null);
  const [loading, setLoading] = useState(true);
  
  const videoRef = useRef<HTMLVideoElement>(null);

  const loadData = async () => {
    try {
      const data = await getStages();
      setStages(data);

      // Find current tutorial by ID
      const targetId = Number(id);
      let found: Tutorial | null = null;
      
      for (const stg of data) {
        const match = stg.tutorials.find((t: Tutorial) => t.id === targetId);
        if (match) {
          found = match;
          break;
        }
      }

      if (found) {
        setCurrentTutorial(found);
      } else {
        showToast('Video module not found', 'error');
        navigate('/tutorials');
      }
    } catch (err) {
      showToast('Failed to load player configurations', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id]);

  const handleVideoEnded = async () => {
    if (!currentTutorial) return;
    
    // If already completed, ignore
    if (currentTutorial.is_completed) return;

    try {
      await completeTutorial(currentTutorial.id);
      showToast(`Module completed: "${currentTutorial.title}"`, 'success');
      
      // Reload stages data to update completion checks
      const updatedData = await getStages();
      setStages(updatedData);
      
      // Update current tutorial completed state
      setCurrentTutorial(prev => prev ? { ...prev, is_completed: true } : null);
    } catch (e) {
      console.error('Failed to save completion:', e);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <div className="spinner">Loading player panel...</div>
      </div>
    );
  }

  if (!currentTutorial) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Back button */}
      <div>
        <button 
          onClick={() => navigate('/tutorials')}
          className="btn btn-outline"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '0.875rem' }}
        >
          <ChevronLeft size={16} />
          <span>Back to Modules</span>
        </button>
      </div>

      {/* Main player workspace grid */}
      <div 
        style={{ 
          display: 'grid', 
          gridTemplateColumns: '3fr 1.2fr', 
          gap: 'var(--space-6)',
          alignItems: 'flex-start'
        }}
        className="player-grid"
      >
        {/* Left Column: Player & Info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Glassmorphic Video Box */}
          <div 
            style={{ 
              backgroundColor: 'black', 
              borderRadius: 'var(--radius-xl)', 
              overflow: 'hidden', 
              boxShadow: 'var(--shadow-lg)',
              position: 'relative',
              aspectRatio: '16/9'
            }}
          >
            <video
              ref={videoRef}
              src={currentTutorial.video_url}
              controls
              onEnded={handleVideoEnded}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              poster="https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=1200&q=80" // healthcare backdrop poster
            />
          </div>

          {/* Module description */}
          <div className="card" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--primary-500)', letterSpacing: '0.05em' }}>
                {currentTutorial.module_number} • Video Lesson
              </span>
              {currentTutorial.is_completed && (
                <span className="badge badge-success" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <CheckCircle size={12} /> Completed ✓
                </span>
              )}
            </div>
            
            <h2 className="font-display" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 12px 0' }}>
              {currentTutorial.title}
            </h2>

            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', lineHeight: 1.5, margin: 0 }}>
              {currentTutorial.description}
            </p>

            <div style={{ display: 'flex', gap: '20px', fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '24px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Clock size={14} /> {currentTutorial.duration_minutes} Mins Duration
              </span>
              <span>•</span>
              <span style={{ color: 'var(--primary-500)', fontWeight: 600 }}>
                Tip: Watch this video to the end to mark it as completed and unlock assessments!
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Sidebar Playlist */}
        <div className="card" style={{ padding: '20px', height: 'fit-content', maxHeight: '72vh', display: 'flex', flexDirection: 'column' }}>
          <h3 className="font-display" style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 16px 0', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
            Course Playlist
          </h3>

          <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }} className="custom-scrollbar">
            {stages.map((stg) => (
              <div key={stg.id}>
                {/* Stage header inside playlist */}
                <h4 style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{stg.title.split(':')[0]}</span>
                  {stg.is_locked && <Lock size={12} />}
                </h4>

                {/* Tutorials item checklist */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {stg.tutorials.map((tut) => {
                    const isPlaying = tut.id === currentTutorial.id;
                    return (
                      <button
                        key={tut.id}
                        onClick={() => !stg.is_locked && navigate(`/tutorials/${tut.id}`)}
                        disabled={stg.is_locked}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-md)',
                          border: isPlaying ? '1px solid var(--primary-400)' : '1px solid transparent',
                          backgroundColor: isPlaying ? 'var(--primary-50)' : 'transparent',
                          color: isPlaying ? 'var(--primary-800)' : 'var(--text-primary)',
                          width: '100%',
                          textAlign: 'left',
                          cursor: stg.is_locked ? 'not-allowed' : 'pointer',
                          opacity: stg.is_locked ? 0.5 : 1,
                        }}
                        className={`playlist-item ${isPlaying ? 'active' : ''}`}
                      >
                        {/* Play/Complete state circle */}
                        <div 
                          style={{ 
                            width: '20px', 
                            height: '20px', 
                            borderRadius: '50%', 
                            border: `2px solid ${tut.is_completed ? 'var(--success-500)' : 'var(--gray-300)'}`,
                            backgroundColor: tut.is_completed ? 'var(--success-500)' : 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            color: 'white'
                          }}
                        >
                          {tut.is_completed ? (
                            <Check size={12} strokeWidth={3} />
                          ) : (
                            <Play size={8} style={{ fill: isPlaying ? 'var(--primary-500)' : 'var(--text-muted)', stroke: 'none', marginLeft: '1px' }} />
                          )}
                        </div>

                        {/* Title text */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: '0.8125rem', fontWeight: 600, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {tut.title}
                          </span>
                          <span style={{ fontSize: '0.718rem', color: isPlaying ? 'var(--primary-600)' : 'var(--text-muted)' }}>
                            {tut.duration_minutes}m duration
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};

export default TutorialPlayerPage;
