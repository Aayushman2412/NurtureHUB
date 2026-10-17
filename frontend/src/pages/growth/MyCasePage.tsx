import React from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import GrowthCaseView from '../../components/growth/GrowthCaseView';

/**
 * A learner's own case page (review of 17 Oct 2026): everything the
 * supervisors see for this mother and baby — forms visit by visit, the WHO
 * charts, activity against what was due — so the learner can see what
 * changed between visits. Only the learner's own cases open (404 otherwise).
 */
const MyCasePage: React.FC = () => {
  const { childId } = useParams<{ childId: string }>();
  const [params] = useSearchParams();
  const from = params.get('from');
  const backTo = from === 'dashboard' ? '/dashboard' : from?.startsWith('mother-') ? `/mothers/${from.slice(7)}` : '/growth';
  return <GrowthCaseView childId={Number(childId)} mode="learner" backTo={backTo} />;
};

export default MyCasePage;
