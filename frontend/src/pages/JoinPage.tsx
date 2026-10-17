import React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageLoader } from '../components/ui';
import { setJoinProject } from '../api/registration';

/**
 * A project's sign-up link, /join/<project> (review of 17 Oct 2026: "I should
 * give you a link of the form where these two will already be filled, so there
 * is no chance of error"). Remembers the project on this device, then goes on
 * to sign-up — or straight to registration for someone already signed in.
 */
const JoinPage: React.FC = () => {
  const { slug = '' } = useParams<{ slug: string }>();
  const { loading, isAuthenticated, isProfileComplete } = useAuth();
  // Written before anything navigates away (idempotent).
  if (slug) setJoinProject(slug);
  if (loading) return <PageLoader />;
  if (!isAuthenticated) return <Navigate to="/signup" replace />;
  return <Navigate to={isProfileComplete ? '/dashboard' : '/register'} replace />;
};

export default JoinPage;
