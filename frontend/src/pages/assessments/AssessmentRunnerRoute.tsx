/**
 * Picks the runner for the `:formKey` in the URL.
 *
 * Flow forms (breastfeeding, complementary feeding) render as a branching,
 * one-question-per-step flow; flat forms (Check Growth) render as a single
 * scrolling field list. Dispatching here — rather than branching inside a
 * runner — keeps each page's hooks unconditional.
 */

import React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { isFlatResponseFormKey, isResponseFormKey } from '../../lib/flowTypes';
import AssessmentRunnerPage from './AssessmentRunnerPage';
import FlatAssessmentRunnerPage from './FlatAssessmentRunnerPage';

const AssessmentRunnerRoute: React.FC = () => {
  const { motherId, formKey } = useParams();
  const key = formKey ?? '';

  if (!isResponseFormKey(key)) return <Navigate to={`/mothers/${motherId}`} replace />;
  return isFlatResponseFormKey(key) ? <FlatAssessmentRunnerPage /> : <AssessmentRunnerPage />;
};

export default AssessmentRunnerRoute;
