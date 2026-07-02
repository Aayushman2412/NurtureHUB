import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';

// Pages

import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import OTPPage from './pages/OTPPage';
import RegistrationPage from './pages/RegistrationPage';
import DashboardPage from './pages/DashboardPage';
import TutorialsPage from './pages/TutorialsPage';
import TutorialPlayerPage from './pages/TutorialPlayerPage';
import TestsPage from './pages/TestsPage';
import TestInstructionsPage from './pages/TestInstructionsPage';
import ActiveTestPage from './pages/ActiveTestPage';
import TestSubmittedPage from './pages/TestSubmittedPage';
import ResultsPage from './pages/ResultsPage';
import ProfilePage from './pages/ProfilePage';

// Layout
import AppLayout from './components/layout/AppLayout';
import AdminLayout from './components/layout/AdminLayout';

// Admin Pages
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import AdminFormBuilderPage from './pages/admin/AdminFormBuilderPage';
import AdminTutorialsPage from './pages/admin/AdminTutorialsPage';
import AdminTestsPage from './pages/admin/AdminTestsPage';
import AdminDistrictsPage from './pages/admin/AdminDistrictsPage';

// --- Route Guards ---

// Public Only Route: Redirects to dashboard if logged in and completely registered
const PublicRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isVerified, isProfileComplete } = useAuth();
  
  if (isAuthenticated) {
    if (!isVerified) return <Navigate to="/verify" replace />;
    if (!isProfileComplete) return <Navigate to="/register" replace />;
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
};

// Protected Route: Must be logged in
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
};

// Verified Route: Must be logged in & OTP verified
const VerifiedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isVerified } = useAuth();

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!isVerified) return <Navigate to="/verify" replace />;
  return <>{children}</>;
};

// Complete Profile Route: Must be logged in, verified, and profile must be completed
const CompleteRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isVerified, isProfileComplete } = useAuth();

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!isVerified) return <Navigate to="/verify" replace />;
  if (!isProfileComplete) return <Navigate to="/register" replace />;
  
  return <AppLayout>{children}</AppLayout>;
};

// Admin Route: Check localStorage for admin access
const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isAdmin = localStorage.getItem('nh_admin') === 'true';
  if (!isAdmin) return <Navigate to="/login" replace />;
  return <AdminLayout>{children}</AdminLayout>;
};

const AppRoutes: React.FC = () => {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: 'var(--bg-primary)' }}>
        <div className="spinner" style={{ fontSize: '1.5rem', color: 'var(--primary-500)' }}>Initializing NurtureHUB...</div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Public Pages */}
      <Route path="/" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/signup" element={<PublicRoute><SignupPage /></PublicRoute>} />
      <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />

      {/* OTP verification is protected from guest, but verified state is checked */}
      <Route path="/verify" element={<ProtectedRoute><OTPPage /></ProtectedRoute>} />

      {/* Profile Builder/Registration (only accessible to verified, incomplete profiles) */}
      <Route path="/register" element={
        <VerifiedRoute>
          <RegistrationPage />
        </VerifiedRoute>
      } />

      {/* Main Core Platform Pages (Require full completion) */}
      <Route path="/dashboard" element={<CompleteRoute><DashboardPage /></CompleteRoute>} />
      <Route path="/tutorials" element={<CompleteRoute><TutorialsPage /></CompleteRoute>} />
      <Route path="/tutorials/:id" element={<CompleteRoute><TutorialPlayerPage /></CompleteRoute>} />
      <Route path="/tests" element={<CompleteRoute><TestsPage /></CompleteRoute>} />
      <Route path="/tests/:id/instructions" element={<CompleteRoute><TestInstructionsPage /></CompleteRoute>} />
      <Route path="/tests/:id/take" element={<CompleteRoute><ActiveTestPage /></CompleteRoute>} />
      <Route path="/tests/:id/submitted" element={<CompleteRoute><TestSubmittedPage /></CompleteRoute>} />
      <Route path="/results/:attemptId" element={<CompleteRoute><ResultsPage /></CompleteRoute>} />
      <Route path="/profile" element={<CompleteRoute><ProfilePage /></CompleteRoute>} />

      {/* Admin Panel Routes */}
      <Route path="/admin" element={<AdminRoute><AdminDashboardPage /></AdminRoute>} />
      <Route path="/admin/districts" element={<AdminRoute><AdminDistrictsPage /></AdminRoute>} />
      <Route path="/admin/form-builder" element={<AdminRoute><AdminFormBuilderPage /></AdminRoute>} />
      <Route path="/admin/tutorials" element={<AdminRoute><AdminTutorialsPage /></AdminRoute>} />
      <Route path="/admin/tests" element={<AdminRoute><AdminTestsPage /></AdminRoute>} />

      {/* Catch-all fallback */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
};

function App() {
  return (
    <Router>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </Router>
  );
}

export default App;
