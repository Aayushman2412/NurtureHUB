import client from './client';
import { triggerBlobDownload } from './pipelines';

/** Faltering cases for the supervisors (review of 18 Oct 2026) — backend
 *  app/faltering.py, GET /api/admin/growth/faltering. */
export type FalterCondition = 'suw' | 'muw' | 'sam' | 'mam' | 'sst' | 'mst' | 'faltering';

export interface FalterRow {
  case_id: number;
  mother_id: number;
  flags: FalterCondition[];
  learner: { id: number | null; name: string | null; cadre: string | null; block: string | null; mobile: string | null };
  batch: string | null;
  monitor: { id: number; name: string | null } | null;
  mother: { name: string | null; uid: string | null; village: string | null };
  child: { name: string | null; uid: string | null; sex: 'boys' | 'girls' | null; dob: string | null; age_months: number | null };
  last_visit: string | null;
  days_since_visit: number | null;
  weight: number | null;
  length: number | null;
  weight_change_g: number | null;
  z: { wfaz: number | null; hfaz: number | null; wfhz: number | null };
  categories: { wfaz: string | null; hfaz: string | null; wfhz: string | null };
}

export interface FalterFilters {
  district?: string;
  conditions?: FalterCondition[];
  monitor?: string;      // a batch monitor's user id, or 'none'
  batch?: string;
  block?: string;
  cadre?: string;
  learner_id?: number;
}

export interface FalterResponse {
  rows: FalterRow[];
  total: number;
  conditions: { key: FalterCondition; label: string }[];
  counts: Record<FalterCondition, number>;
  options: {
    monitors: { id: number; name: string | null }[];
    no_monitor: boolean;
    batches: string[];
    blocks: string[];
    cadres: string[];
    learners: [number, string | null][];
  };
}

const params = (f: FalterFilters) => ({
  ...(f.district ? { district: f.district } : {}),
  ...(f.conditions?.length ? { conditions: f.conditions.join(',') } : {}),
  ...(f.monitor ? { monitor: f.monitor } : {}),
  ...(f.batch ? { batch: f.batch } : {}),
  ...(f.block ? { block: f.block } : {}),
  ...(f.cadre ? { cadre: f.cadre } : {}),
  ...(f.learner_id ? { learner_id: f.learner_id } : {}),
});

export const getFalteringCases = (f: FalterFilters): Promise<FalterResponse> =>
  client.get('/api/admin/growth/faltering', { params: params(f) }).then(r => r.data);

export const downloadFalteringXlsx = async (f: FalterFilters): Promise<void> => {
  const res = await client.get('/api/admin/growth/faltering/export', { params: params(f), responseType: 'blob' });
  const disposition = String(res.headers?.['content-disposition'] || '');
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  triggerBlobDownload(res.data as Blob, match ? decodeURIComponent(match[1]) : 'faltering-cases.xlsx');
};
