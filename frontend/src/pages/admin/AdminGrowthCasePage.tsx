import React from 'react';
import { useParams } from 'react-router-dom';
import GrowthCaseView from '../../components/growth/GrowthCaseView';

/**
 * Full-page case drill-down, opened in a NEW TAB from a Learner Activities
 * summary-table row. The page itself is shared with the learner's own case
 * page — components/growth/GrowthCaseView.
 */
const AdminGrowthCasePage: React.FC = () => {
  const { childId } = useParams<{ childId: string }>();
  return <GrowthCaseView childId={Number(childId)} mode="admin" backTo="/admin/growth" />;
};

export default AdminGrowthCasePage;
