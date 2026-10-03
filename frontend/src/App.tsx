import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';
import OfflineSyncManager from './offline/OfflineSyncManager';

// Critical entry pages (eager for zero-delay first paint)
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';

// Public & Auth pages (lazy)
const SignupPage = lazy(() => import('./pages/SignupPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const OTPPage = lazy(() => import('./pages/OTPPage'));
const RegistrationPage = lazy(() => import('./pages/RegistrationPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));

// Core Learner & Field pages (lazy)
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const TutorialsPage = lazy(() => import('./pages/TutorialsPage'));
const TutorialPlayerPage = lazy(() => import('./pages/TutorialPlayerPage'));
const TestsPage = lazy(() => import('./pages/TestsPage'));
const TestInstructionsPage = lazy(() => import('./pages/TestInstructionsPage'));
const ActiveTestPage = lazy(() => import('./pages/ActiveTestPage'));
const TestSubmittedPage = lazy(() => import('./pages/TestSubmittedPage'));
const ResultsPage = lazy(() => import('./pages/ResultsPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const MothersListPage = lazy(() => import('./pages/mothers/MothersListPage'));
const MotherFormPage = lazy(() => import('./pages/mothers/MotherFormPage'));
const MotherDetailPage = lazy(() => import('./pages/mothers/MotherDetailPage'));
const ChildFormPage = lazy(() => import('./pages/mothers/ChildFormPage'));
const AssessmentHistoryPage = lazy(() => import('./pages/assessments/AssessmentHistoryPage'));
const AssessmentRunnerRoute = lazy(() => import('./pages/assessments/AssessmentRunnerRoute'));
const AssessmentPlanPage = lazy(() => import('./pages/assessments/AssessmentPlanPage'));
const GrowthChartsPage = lazy(() => import('./pages/growth/GrowthChartsPage'));

// Layout
import { PageLoader } from './components/ui';
const AppLayout = lazy(() => import('./components/layout/AppLayout'));
const AdminLayout = lazy(() => import('./components/layout/AdminLayout'));

// Admin Pages (lazy — heavily isolated from frontline worker bundles)
const AdminDashboardPage = lazy(() => import('./pages/admin/AdminDashboardPage'));
const FormBuilderHubPage = lazy(() => import('./pages/admin/formbuilder/FormBuilderHubPage'));
const FormVersionsPage = lazy(() => import('./pages/admin/formbuilder/FormVersionsPage'));
const FlatFormEditorPage = lazy(() => import('./pages/admin/formbuilder/FlatFormEditorPage'));
const FlowBuilderPage = lazy(() => import('./pages/admin/formbuilder/FlowBuilderPage'));
const FormPrintPage = lazy(() => import('./pages/admin/formbuilder/FormPrintPage'));
const AdminTutorialsPage = lazy(() => import('./pages/admin/AdminTutorialsPage'));
const AdminTutorialTrackingPage = lazy(() => import('./pages/admin/AdminTutorialTrackingPage'));
const AdminResultsPage = lazy(() => import('./pages/admin/AdminResultsPage'));
const AdminTestsPage = lazy(() => import('./pages/admin/AdminTestsPage'));
const AdminProjectsPage = lazy(() => import('./pages/admin/AdminProjectsPage'));
const AdminLearnersPage = lazy(() => import('./pages/admin/AdminLearnersPage'));
const AdminLiveMonitorPage = lazy(() => import('./pages/admin/AdminLiveMonitorPage'));
const AdminGrowthMonitorPage = lazy(() => import('./pages/admin/AdminGrowthMonitorPage'));
const AdminMasdPage = lazy(() => import('./pages/admin/AdminMasdPage'));
const AdminGrowthCasePage = lazy(() => import('./pages/admin/AdminGrowthCasePage'));
const AdminRawDataPage = lazy(() => import('./pages/admin/AdminRawDataPage'));
const AdminCrosstabsPipelinePage = lazy(() => import('./pages/admin/AdminCrosstabsPipelinePage'));
const AdminMasdPipelinePage = lazy(() => import('./pages/admin/AdminMasdPipelinePage'));
const AdminDataProtectionPage = lazy(() => import('./pages/admin/AdminDataProtectionPage'));
const StyleguidePage = lazy(() => import('./pages/dev/StyleguidePage'));

// --- Route Guards ---

// Public Only Route: Redirects to dashboard if logged in and completely registered
const PublicRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isVerified, isProfileComplete, user } = useAuth();
  
  if (isAuthenticated) {
    if (user?.is_admin || localStorage.getItem('nh_admin') === 'true') {
      return <Navigate to="/admin" replace />;
    }
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

// Admin Route: Check localStorage or user for admin access
const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const isAdmin = localStorage.getItem('nh_admin') === 'true' || !!user?.is_admin;
  if (!isAdmin) return <Navigate to="/login" replace />;
  return <AdminLayout>{children}</AdminLayout>;
};

/** Admin-gated but without the sidebar layout — for full-page/print views. */
const AdminBareRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const isAdmin = localStorage.getItem('nh_admin') === 'true' || !!user?.is_admin;
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
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-background">
          <PageLoader label="Loading…" />
        </div>
      }
    >
      <Routes>
        {/* Public Pages */}
        {/* Landing is visible to everyone — its CTA adapts to auth state */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
        <Route path="/signup" element={<PublicRoute><SignupPage /></PublicRoute>} />
        <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
        {/* Reachable signed out AND signed in: the DPDP right to know what is held
            about you must not depend on being able to log in. */}
        <Route path="/privacy" element={<PrivacyPage />} />

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
        {/* Push notifications deep-link here (digest / link-less payloads):
            land on the dashboard with the notification panel opened. */}
        <Route path="/notifications" element={<Navigate to="/dashboard?notifications=1" replace />} />
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
        <Route path="/admin/projects" element={<AdminRoute><AdminProjectsPage /></AdminRoute>} />
        {/* Legacy path kept so bookmarks still work. */}
        <Route path="/admin/districts" element={<Navigate to="/admin/projects" replace />} />
        <Route path="/admin/learners" element={<AdminRoute><AdminLearnersPage /></AdminRoute>} />
        <Route path="/admin/form-builder" element={<AdminRoute><FormBuilderHubPage /></AdminRoute>} />
        <Route path="/admin/form-builder/versions/:formKey" element={<AdminRoute><FormVersionsPage /></AdminRoute>} />
        <Route path="/admin/form-builder/flat/:formKey" element={<AdminRoute><FlatFormEditorPage /></AdminRoute>} />
        <Route path="/admin/form-builder/flow/:formKey" element={<AdminRoute><FlowBuilderPage /></AdminRoute>} />
        <Route path="/admin/form-builder/print/:formKey" element={<AdminBareRoute><FormPrintPage /></AdminBareRoute>} />
        <Route path="/admin/tutorials" element={<AdminRoute><AdminTutorialsPage /></AdminRoute>} />
        <Route path="/admin/tutorial-tracking" element={<AdminRoute><AdminTutorialTrackingPage /></AdminRoute>} />
        <Route path="/admin/results" element={<AdminRoute><AdminResultsPage /></AdminRoute>} />
        <Route path="/admin/tests" element={<AdminRoute><AdminTestsPage /></AdminRoute>} />
        <Route path="/admin/tests/:testId/monitor" element={<AdminRoute><AdminLiveMonitorPage /></AdminRoute>} />
        <Route path="/admin/growth" element={<AdminRoute><AdminGrowthMonitorPage /></AdminRoute>} />
        <Route path="/admin/masd" element={<AdminRoute><AdminMasdPage /></AdminRoute>} />
        <Route path="/admin/growth/cases/:childId" element={<AdminRoute><AdminGrowthCasePage /></AdminRoute>} />
        <Route path="/admin/data-protection" element={<AdminRoute><AdminDataProtectionPage /></AdminRoute>} />
        <Route path="/admin/database/rawdata" element={<AdminRoute><AdminRawDataPage /></AdminRoute>} />
        <Route path="/admin/database/crosstabs" element={<AdminRoute><AdminCrosstabsPipelinePage /></AdminRoute>} />
        <Route path="/admin/database/masd" element={<AdminRoute><AdminMasdPipelinePage /></AdminRoute>} />

        {/* Dev-only styleguide */}
        {import.meta.env.DEV && <Route path="/dev/styleguide" element={<StyleguidePage />} />}

        {/* Catch-all fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
};

function App() {
  return (
    <Router>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <OfflineSyncManager />
            <AppRoutes />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </Router>
  );
}

export default App;
