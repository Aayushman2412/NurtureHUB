import React, { useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { Sun, Moon, Globe, ChevronDown, BookOpen, Award } from 'lucide-react';
import { Link } from 'react-router-dom';

interface AuthLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle: string;
}

const AuthLayout: React.FC<AuthLayoutProps> = ({ children, title, subtitle }) => {
  const { darkMode, toggleDarkMode } = useTheme();
  const [selectedLang, setSelectedLang] = useState('English');
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);

  const languages = [
    { name: 'English', native: 'English' },
    { name: 'Hindi', native: 'हिंदी' },
    { name: 'Tamil', native: 'தமிழ்' },
    { name: 'Telugu', native: 'తెలుగు' },
    { name: 'Marathi', native: 'मराठी' },
    { name: 'Bengali', native: 'বাংলা' },
    { name: 'Kannada', native: 'ಕನ್ನಡ' }
  ];

  return (
    <div className="auth-layout-root">
      {/* Dark Mode toggle on absolute top-right */}
      <div className="auth-theme-toggle">
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
      <div className="auth-layout-inner">
        
        {/* Left Side: Forms (scrollable) */}
        <div className="auth-form-panel">
          {/* Top Row: Language Selector */}
          <div className="auth-top-row" style={{ display: 'flex', justifyContent: 'flex-start', width: '100%', marginBottom: '24px' }}>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setLangDropdownOpen(!langDropdownOpen)}
                className="lang-selector-btn"
              >
                <Globe size={16} />
                <span>{selectedLang}</span>
                <ChevronDown size={14} style={{ transform: langDropdownOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
              </button>
              {langDropdownOpen && (
                <div className="lang-dropdown">
                  {languages.map((lang) => (
                    <button
                      key={lang.name}
                      type="button"
                      onClick={() => {
                        setSelectedLang(lang.name);
                        setLangDropdownOpen(false);
                      }}
                      className="lang-dropdown-item"
                    >
                      <span>{lang.name}</span>
                      <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>{lang.native}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Center Content: Welcome & Actions */}
          <div className="auth-form-container" style={{ margin: 'auto 0' }}>
            {/* Header logo block */}
            <div className="auth-logo-block">
              <span style={{ fontSize: '2.25rem' }}>🌱</span>
              <div>
                <span className="brand-name" style={{ fontSize: '1.5rem', display: 'block', fontWeight: 800, color: 'var(--text-primary)' }}>NurtureHUB</span>
                <span style={{ fontSize: '0.75rem', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--primary-500)', fontWeight: 700 }}>ICDS Training Platform</span>
              </div>
            </div>

            <h2 className="font-display auth-form-title">
              {title}
            </h2>
            <p className="auth-form-subtitle">
              {subtitle}
            </p>

            {children}
          </div>

          {/* Bottom Row: Footer-lite */}
          <div className="auth-bottom-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginTop: '24px', opacity: 0.6, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
            <p>© 2026 NurtureHUB. All rights reserved.</p>
            <div style={{ display: 'flex', gap: '16px' }}>
              <Link to="#" style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.2s' }}>Privacy Policy</Link>
              <Link to="#" style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.2s' }}>Terms</Link>
            </div>
          </div>
        </div>

        {/* Right Side: Visual banner panels */}
        <div className="auth-visual-panel">
          {/* Decorative Background Elements */}
          <div className="auth-visual-blob-1" />
          <div className="auth-visual-blob-2" />

          <div style={{ position: 'relative', zIndex: 1, maxWidth: '480px', width: '100%', margin: '0 auto', textAlign: 'center' }}>
            {/* Branding */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '32px' }}>
              <div className="auth-brand-logo-container">
                <span style={{ fontSize: '3rem' }}>🌱</span>
              </div>
              <div style={{ textAlign: 'center' }}>
                <h3 className="font-display auth-visual-heading" style={{ margin: 0 }}>
                  Nurturing Skills, Elevating Communities
                </h3>
                <div className="auth-brand-title-divider" />
              </div>
            </div>

            {/* Descriptive Content */}
            <div style={{ marginBottom: '32px' }}>
              <p className="auth-visual-description">
                Access standardized training videos, complete knowledge-check assessments, unlock specialized badges, and monitor your personal growth journey.
              </p>
              
              {/* Feature Bento Layout */}
              <div className="auth-features-bento">
                <div className="auth-bento-card">
                  <BookOpen className="auth-bento-card-icon" size={24} />
                  <h4 className="auth-bento-card-title">Training Modules</h4>
                  <p className="auth-bento-card-desc">Interactive video tutorials designed specifically for ICDS & Anganwadi workflows.</p>
                </div>
                <div className="auth-bento-card">
                  <Award className="auth-bento-card-icon" size={24} />
                  <h4 className="auth-bento-card-title">Assessments & Badges</h4>
                  <p className="auth-bento-card-desc">Structured knowledge checks to verify learning and earn official milestone badges.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default AuthLayout;
