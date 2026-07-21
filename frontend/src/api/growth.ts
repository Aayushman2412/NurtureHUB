import client from './client';
import type { FormResponseDetail } from '../lib/flowTypes';

/** One x-point of a WHO percentile table (x = age in days, or length in cm). */
export interface GrowthStandardPoint {
  x: number;
  p3: number;
  p15: number;
  p50: number;
  p85: number;
  p97: number;
}

export type GrowthIndicator = 'wfa' | 'lfa' | 'wfl';
export type GrowthSex = 'boys' | 'girls';
export type GrowthStandards = Record<GrowthIndicator, Record<GrowthSex, GrowthStandardPoint[]>>;

/** One LAP visit: all form responses filed for a child on one date. */
export interface GrowthVisit {
  date: string;
  age_days: number | null;
  weight: number | null;
  length: number | null;
  /** Form keys filed that day (determines the point/line color). */
  sources: string[];
  /** form_key → response id, for the visit-detail drill-down. */
  forms: Record<string, number>;
}

/** A learner-mother-child triple with its chronological visit series. */
export interface GrowthCase {
  child: {
    id: number;
    uid: string;
    name: string;
    gender: string | null;
    dob: string | null;
    birth_weight: number | null;
    birth_length: number | null;
  };
  mother: { id: number; uid: string; name: string };
  /** learner is null for an orphaned case (registering account removed). */
  learner: { id: number | null; name: string | null; email: string | null; district: string | null };
  visits: GrowthVisit[];
}

export const getGrowthStandards = (): Promise<GrowthStandards> =>
  client.get('/api/growth/standards').then(r => r.data);

export const getMyGrowthCases = (): Promise<{ cases: GrowthCase[] }> =>
  client.get('/api/growth/my-cases').then(r => r.data);

export const getAdminGrowthMonitor = (district?: string): Promise<{ cases: GrowthCase[] }> =>
  client
    .get('/api/admin/growth/monitor', { params: district ? { district } : {} })
    .then(r => r.data);

export const getAdminGrowthResponse = (responseId: number): Promise<FormResponseDetail> =>
  client.get(`/api/admin/growth/responses/${responseId}`).then(r => r.data);
