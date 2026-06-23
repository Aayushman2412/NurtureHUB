import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated, isVerified, isProfileComplete } = useAuth();

  const handleCTA = () => {
    if (isAuthenticated) {
      if (!isVerified) {
        navigate('/verify');
      } else if (!isProfileComplete) {
        navigate('/register');
      } else {
        navigate('/dashboard');
      }
    } else {
      navigate('/login');
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-primary)' }}>
      {/* Navigation bar */}
      <nav 
        style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          padding: '20px max(24px, 6%)',
          backgroundColor: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-color)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '2rem' }}>🌱</span>
          <div>
            <span style={{ fontWeight: 800, fontSize: '1.25rem', color: 'var(--text-primary)' }} className="brand-name">NurtureHUB</span>
            <span style={{ fontSize: '0.6875rem', color: 'var(--primary-500)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>ICDS Professional Portal</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '16px' }}>
          {isAuthenticated ? (
            <button className="btn btn-primary" onClick={handleCTA}>Go to App</button>
          ) : (
            <>
              <button className="btn btn-outline" onClick={() => navigate('/login')} style={{ cursor: 'pointer' }}>Sign In</button>
              <button className="btn btn-primary" onClick={() => navigate('/signup')} style={{ cursor: 'pointer' }}>Register</button>
            </>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <section 
        style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center',
          textAlign: 'center', 
          padding: '80px 24px', 
          background: 'linear-gradient(135deg, var(--primary-900) 0%, var(--secondary-900) 100%)',
          color: 'white',
          position: 'relative'
        }}
      >
        <div style={{ maxWidth: '800px' }}>
          <span 
            style={{ 
              backgroundColor: 'rgba(15, 173, 160, 0.2)', 
              color: 'var(--primary-200)', 
              padding: '6px 16px', 
              borderRadius: '20px', 
              fontSize: '0.8125rem', 
              fontWeight: 700, 
              letterSpacing: '0.1em', 
              textTransform: 'uppercase',
              display: 'inline-block',
              marginBottom: '24px'
            }}
          >
            Digital Skill Portal for Healthcare Professionals
          </span>
          <h1 
            className="font-display" 
            style={{ 
              fontSize: 'min(3rem, 9vw)', 
              fontWeight: 800, 
              lineHeight: 1.15, 
              marginBottom: '24px',
              letterSpacing: '-0.03em' 
            }}
          >
            Elevate Anganwadi Training & Assessment
          </h1>
          <p 
            style={{ 
              fontSize: 'max(1.0625rem, 3.5vw)', 
              color: 'var(--secondary-200)', 
              marginBottom: '40px',
              lineHeight: 1.6,
              maxWidth: '680px',
              marginRight: 'auto',
              marginLeft: 'auto'
            }}
          >
            NurtureHUB is a modern learning management framework designed specifically for ICDS professionals. Access interactive tutorial videos, test your knowledge, and unlock achievements.
          </p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={handleCTA} style={{ padding: '14px 28px', fontSize: '1rem', cursor: 'pointer' }}>
              Start Learning Journey
            </button>
            <button 
              className="btn btn-outline" 
              onClick={() => navigate('/login')} 
              style={{ 
                padding: '14px 28px', 
                fontSize: '1rem', 
                color: 'white', 
                borderColor: 'rgba(255,255,255,0.3)',
                backgroundColor: 'rgba(255,255,255,0.05)',
                cursor: 'pointer'
              }}
            >
              Sign In
            </button>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section style={{ padding: '80px max(24px, 6%)', backgroundColor: 'var(--bg-secondary)', flex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: '60px' }}>
          <h2 className="font-display" style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '12px' }}>
            Core Training Pillars
          </h2>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '600px', margin: '0 auto' }}>
            Empowering childcare workers with the right skills and evaluation workflows to assure early developmental care.
          </p>
        </div>

        <div 
          style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
            gap: '30px', 
            maxWidth: '1200px', 
            margin: '0 auto' 
          }}
        >
          {/* Card 1 */}
          <div className="card card-interactive" style={{ padding: '32px' }}>
            <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '16px' }}>🎥</span>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>
              Standardized Tutorials
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', lineHeight: 1.5 }}>
              Structured, stage-wise video modules covering developmental tracker metrics, child nutrition guides, and WHO growth scales.
            </p>
          </div>

          {/* Card 2 */}
          <div className="card card-interactive" style={{ padding: '32px' }}>
            <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '16px' }}>📝</span>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>
              Knowledge Checks
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', lineHeight: 1.5 }}>
              Interactive multiple-choice quizzes designed to consolidate training. Instant scorecards, passing thresholds, and unlimited review attempts.
            </p>
          </div>

          {/* Card 3 */}
          <div className="card card-interactive" style={{ padding: '32px' }}>
            <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '16px' }}>🏆</span>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>
              Earn Achievements
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', lineHeight: 1.5 }}>
              Earn virtual milestone badges (Fast Learner, Scholar, Graduate) as you finish courses and demonstrate skills competency.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer 
        style={{ 
          padding: '40px 24px', 
          backgroundColor: 'var(--secondary-900)', 
          color: 'var(--secondary-300)', 
          textAlign: 'center',
          borderTop: '1px solid var(--secondary-800)',
          fontSize: '0.875rem'
        }}
      >
        <p style={{ margin: 0 }}>© {new Date().getFullYear()} NurtureHUB Framework. All rights reserved.</p>
        <p style={{ fontSize: '0.75rem', color: 'var(--secondary-500)', marginTop: '8px' }}>
          Designed for Department of Women and Child Development (WCD) and ICDS workers.
        </p>
      </footer>
    </div>
  );
};

export default LandingPage;
