/** Admin Database → Raw Data: generate pipeline raw inputs from app data. */
import client from './client';
import { triggerBlobDownload } from './pipelines';

export type RawPipeline = 'crosstabs' | 'masd';

export interface RawFile {
  name: string;
  path: string;
  rows: number;
  size: number;
  modified: string;
}

export interface RawSet {
  pipeline: RawPipeline;
  project: string | null;
  mock: boolean;
  files: RawFile[];
}

const params = (project?: string) => (project ? { project } : {});

export const getRawSet = (pipeline: RawPipeline, project?: string): Promise<RawSet> =>
  client.get(`/api/admin/rawdata/${pipeline}`, { params: params(project) }).then(r => r.data);

export const generateRawSet = (pipeline: RawPipeline, project?: string): Promise<RawSet> =>
  client.post(`/api/admin/rawdata/${pipeline}/generate`, null, { params: params(project) }).then(r => r.data);

export const ingestRawSet = (
  pipeline: RawPipeline,
  project?: string,
): Promise<{ ingested: string[] }> =>
  client.post(`/api/admin/rawdata/${pipeline}/ingest`, null, { params: params(project) }).then(r => r.data);

export const downloadRawFile = async (
  pipeline: RawPipeline,
  path: string,
  project?: string,
): Promise<void> => {
  const res = await client.get(`/api/admin/rawdata/${pipeline}/file`, {
    params: { path, ...params(project) },
    responseType: 'blob',
  });
  triggerBlobDownload(res.data as Blob, path.split('/').pop() || 'raw.csv');
};
