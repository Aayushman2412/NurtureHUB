import React from 'react';
import { useTheme } from '../../context/ThemeContext';
import { Sun, Moon } from 'lucide-react';

interface AuthLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle: string;
}

const AuthLayout: React.FC<AuthLayoutProps> = ({ children, title, subtitle }) => {
  const { darkMode, toggleDarkMode } = useTheme();

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg-primary)' }}>
      {/* Dark Mode toggle on absolute top-right */}
      <div style={{ position: 'absolute', top: '20px', right: '20px', zIndex: 10 }}>
        <button
          onClick={toggleDarkMode}
          className="header-action-btn"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
            width: '40px',
            height: '40px',
            backgroundColor: 'var(--bg-secondary)',
            boxShadow: 'var(--shadow-md)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-primary)',
            cursor: 'pointer'
          }}
          title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {darkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>

      {/* Split Auth Screen Layout */}
      <div style={{ display: 'flex', width: '100%', flexWrap: 'wrap' }}>
        
        {/* Left Side: Forms */}
        <div 
          style={{ 
            flex: '1 1 50%', 
            display: 'flex', 
            flexDirection: 'column', 
            justifyContent: 'center', 
            padding: '40px max(24px, 5%)',
            backgroundColor: 'var(--bg-secondary)',
            minHeight: '100vh',
            boxSizing: 'border-box'
          }}
        >
          <div style={{ maxWidth: '440px', width: '100%', margin: '0 auto' }}>
            {/* Header logo block */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '32px' }}>
              <span style={{ fontSize: '2.25rem' }}>🌱</span>
              <div>
                <span className="brand-name" style={{ fontSize: '1.5rem', display: 'block', fontWeight: 800, color: 'var(--text-primary)' }}>NurtureHUB</span>
                <span style={{ fontSize: '0.75rem', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--primary-500)', fontWeight: 700 }}>ICDS Training Platform</span>
              </div>
            </div>

            <h2 className="font-display" style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '8px' }}>
              {title}
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '32px', fontSize: '0.9375rem' }}>
              {subtitle}
            </p>

            {children}
          </div>
        </div>

        {/* Right Side: Visual banner panels */}
        <div 
          style={{ 
            flex: '1 1 50%', 
            background: 'linear-gradient(135deg, var(--secondary-900) 0%, var(--primary-900) 100%)', 
            color: 'white',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '60px max(40px, 8%)',
            boxSizing: 'border-box',
            minHeight: '100vh',
            position: 'relative',
            overflow: 'hidden'
          }}
          className="auth-visual-panel"
        >
          {/* Glassmorphic decorative grid bubbles */}
          <div style={{
            position: 'absolute',
            width: '400px',
            height: '400px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, var(--primary-500) 0%, transparent 70%)',
            top: '-10%',
            right: '-10%',
            opacity: 0.15,
            pointerEvents: 'none'
          }} />
          <div style={{
            position: 'absolute',
            width: '300px',
            height: '300px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, var(--accent-500) 0%, transparent 70%)',
            bottom: '10%',
            left: '-10%',
            opacity: 0.1,
            pointerEvents: 'none'
          }} />

          {/* Slogan */}
          <div style={{ maxWidth: '480px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--primary-300)', backgroundColor: 'rgba(15,173,160,0.15)', padding: '6px 12px', borderRadius: '4px', display: 'inline-block', marginBottom: '24px' }}>
              Empowering Anganwadi & ICDS Teams
            </span>
            <h3 className="font-display" style={{ fontSize: '2.5rem', fontWeight: 800, lineHeight: 1.2, marginBottom: '24px', letterSpacing: '-0.02em' }}>
              Nurturing Skills, Elevating Communities
            </h3>
            <p style={{ fontSize: '1.0625rem', color: 'var(--secondary-200)', lineHeight: 1.6 }}>
              Access standardized training videos, complete knowledge-check assessments, unlock specialized badges, and monitor your personal growth journey.
            </p>
          </div>

          {/* Review card */}
          <div 
            style={{ 
              maxWidth: '480px', 
              backgroundColor: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              backdropFilter: 'blur(16px)',
              padding: '24px',
              borderRadius: '12px',
              boxShadow: 'var(--shadow-xl)',
              marginTop: '40px'
            }}
          >
            <p style={{ fontSize: '0.9375rem', color: '#E2E8F0', fontStyle: 'italic', marginBottom: '16px', lineHeight: 1.5 }}>
              "The assessments on NurtureHUB have helped me build confidence in identifying SAM indicators. I can now counseling mothers with standard checklist references."
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div className="avatar avatar-sm font-display" style={{ backgroundColor: 'var(--primary-500)', color: 'white', fontWeight: 600 }}>
                PM
              </div>
              <div>
                <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'white', margin: 0 }}>Priya Mishra</h4>
                <span style={{ fontSize: '0.75rem', color: 'var(--primary-300)' }}>Anganwadi Supervisor • Gorakhpur</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default AuthLayout;
