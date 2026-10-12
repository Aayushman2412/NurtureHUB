import React from 'react';
import { cn } from '../../utils/cn';

export interface LearnerIdentityProps {
  name: string;
  id?: number | string | null;
  mobile?: string | null;
  /** Short cadre: "AWW", "ASHA", "SN". */
  cadre?: string | null;
  /** Optional place — block, or "block, district" in a state project. */
  place?: string | null;
  /** Shown on hover only: an email is no use to anyone in the field. */
  email?: string | null;
  idLabel?: string;
  className?: string;
}

/**
 * How a learner is shown in every admin table (review of 5 Oct 2026): their
 * name, then the three things a programme team recognises them by — user ID,
 * mobile number and cadre — with block/district where there is room.
 */
const LearnerIdentity: React.FC<LearnerIdentityProps> = ({
  name, id, mobile, cadre, place, email, idLabel = 'ID', className,
}) => (
  <div className={cn('min-w-0', className)} title={email ?? undefined}>
    <div className="truncate font-semibold text-ink">{name}</div>
    <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
      {id != null && <span className="font-semibold tabular-nums text-ink">{idLabel} {id}</span>}
      {mobile && <><span aria-hidden>·</span><span className="tabular-nums">{mobile}</span></>}
      {cadre && <><span aria-hidden>·</span><span className="font-medium">{cadre}</span></>}
      {place && <><span aria-hidden>·</span><span className="truncate">{place}</span></>}
    </div>
  </div>
);

export default LearnerIdentity;
