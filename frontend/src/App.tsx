import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';

// Pages

import LandingPage from './pages/LandingPage';
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
import MothersListPage from './pages/mothers/MothersListPage';
import MotherFormPage from './pages/mothers/MotherFormPage';
import MotherDetailPage from './pages/mothers/MotherDetailPage';
import ChildFormPage from './pages/mothers/ChildFormPage';
import AssessmentHistoryPage from './pages/assessments/AssessmentHistoryPage';
import AssessmentRunnerRoute from './pages/assessments/AssessmentRunnerRoute';
import AssessmentRunnerPage from './pages/assessments/AssessmentRunnerPage';
import AssessmentPlanPage from './pages/assessments/AssessmentPlanPage';
import GrowthChartsPage from './pages/growth/GrowthChartsPage';

// Layout
import { PageLoader } from './components/ui';
import AppLayout from './components/layout/AppLayout';
import AdminLayout from './components/layout/AdminLayout';

// Admin Pages
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
// Dev-only styleguide (tree-shaken out of prod builds)
import StyleguidePage from './pages/dev/StyleguidePage';
import FormBuilderHubPage from './pages/admin/formbuilder/FormBuilderHubPage';
import FlatFormEditorPage from './pages/admin/formbuilder/FlatFormEditorPage';
import FlowBuilderPage from './pages/admin/formbuilder/FlowBuilderPage';
import FormPrintPage from './pages/admin/formbuilder/FormPrintPage';
import AdminTutorialsPage from './pages/admin/AdminTutorialsPage';
import AdminTutorialTrackingPage from './pages/admin/AdminTutorialTrackingPage';
import AdminResultsPage from './pages/admin/AdminResultsPage';
import AdminTestsPage from './pages/admin/AdminTestsPage';
import AdminDistrictsPage from './pages/admin/AdminDistrictsPage';
import AdminLiveMonitorPage from './pages/admin/AdminLiveMonitorPage';
import AdminGrowthMonitorPage from './pages/admin/AdminGrowthMonitorPage';

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

/** Admin-gated but without the sidebar layout — for full-page/print views. */
const AdminBareRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isAdmin = localStorage.getItem('nh_admin') === 'true';
  if (!isAdmin) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const AppRoutes: React.FC = () => {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <PageLoader label="Initializing NurtureHUB…" />
      </div>
    );
  }

  return (
    <Routes>
      {/* Public Pages */}
      {/* Landing is visible to everyone — its CTA adapts to auth state */}
      <Route path="/" element={<LandingPage />} />
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

      {/* Mother Registration */}
      <Route path="/mothers" element={<CompleteRoute><MothersListPage /></CompleteRoute>} />
      <Route path="/mothers/new" element={<CompleteRoute><MotherFormPage /></CompleteRoute>} />
      <Route path="/mothers/:id" element={<CompleteRoute><MotherDetailPage /></CompleteRoute>} />

      {/* Child Registration (nested under a mother) */}
      <Route path="/mothers/:motherId/children/new" element={<CompleteRoute><ChildFormPage /></CompleteRoute>} />
      <Route path="/mothers/:motherId/children/:childId" element={<CompleteRoute><ChildFormPage /></CompleteRoute>} />

      {/* Per-child assessments: BF/CF (flow) + Check Growth (flat) */}
      <Route path="/mothers/:motherId/children/:childId/assessments/:formKey" element={<CompleteRoute><AssessmentHistoryPage /></CompleteRoute>} />
      <Route path="/mothers/:motherId/children/:childId/assessments/:formKey/run" element={<CompleteRoute><AssessmentRunnerRoute /></CompleteRoute>} />
      {/* Per-mother assessments (protein intake — flow only) */}
      <Route path="/mothers/:motherId/assessments/:formKey" element={<CompleteRoute><AssessmentHistoryPage /></CompleteRoute>} />
      <Route path="/mothers/:motherId/assessments/:formKey/run" element={<CompleteRoute><AssessmentRunnerRoute /></CompleteRoute>} />
      <Route path="/assessments/:responseId/plan" element={<CompleteRoute><AssessmentPlanPage /></CompleteRoute>} />

      {/* Growth charts (LAP monitoring) — case-wise WHO percentile charts */}
      <Route path="/growth" element={<CompleteRoute><GrowthChartsPage /></CompleteRoute>} />

      {/* Admin Panel Routes */}
      <Route path="/admin" element={<AdminRoute><AdminDashboardPage /></AdminRoute>} />
      <Route path="/admin/districts" element={<AdminRoute><AdminDistrictsPage /></AdminRoute>} />
      <Route path="/admin/form-builder" element={<AdminRoute><FormBuilderHubPage /></AdminRoute>} />
      <Route path="/admin/form-builder/flat/:formKey" element={<AdminRoute><FlatFormEditorPage /></AdminRoute>} />
      <Route path="/admin/form-builder/flow/:formKey" element={<AdminRoute><FlowBuilderPage /></AdminRoute>} />
      <Route path="/admin/form-builder/print/:formKey" element={<AdminBareRoute><FormPrintPage /></AdminBareRoute>} />
      <Route path="/admin/tutorials" element={<AdminRoute><AdminTutorialsPage /></AdminRoute>} />
      <Route path="/admin/tutorial-tracking" element={<AdminRoute><AdminTutorialTrackingPage /></AdminRoute>} />
      <Route path="/admin/results" element={<AdminRoute><AdminResultsPage /></AdminRoute>} />
      <Route path="/admin/tests" element={<AdminRoute><AdminTestsPage /></AdminRoute>} />
      <Route path="/admin/tests/:testId/monitor" element={<AdminRoute><AdminLiveMonitorPage /></AdminRoute>} />
      <Route path="/admin/growth" element={<AdminRoute><AdminGrowthMonitorPage /></AdminRoute>} />

      {/* Dev-only styleguide */}
      {import.meta.env.DEV && <Route path="/dev/styleguide" element={<StyleguidePage />} />}

      {/* Catch-all fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
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
