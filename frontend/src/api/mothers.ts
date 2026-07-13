import client from './client';

export interface SourceRating {
  source: string;
  trust?: number | null;
  willingness?: number | null;
}

/** Payload for create/update — mirrors the backend MotherCreate schema. */
export interface MotherPayload {
  mother_name: string;
  adoption_date?: string | null;
  mother_dob?: string | null;
  mother_age?: number | null;
  weight?: number | null;
  height?: number | null;
  lmp?: string | null;
  edd_records?: string | null;
  mobile?: string | null;
  alternate_mobile?: string | null;
  email?: string | null;
  state_id?: number | null;
  district_id?: number | null;
  taluk_id?: number | null;
  village?: string | null;
  hwc_id?: number | null;
  phc_id?: number | null;
  education_id?: number | null;
  education_field_id?: number | null;
  education_degree_id?: number | null;
  occupation?: string | null;
  occupation_other?: string | null;
  ration_card?: string | null;
  social_category?: string | null;
  nutrition_course?: boolean | null;
  nutrition_course_name?: string | null;
  video_frequency?: string | null;
  implement_video?: string | null;
  confidence_video?: string | null;
  willingness_hcw?: string | null;
  information_seeking?: string | null;
  source_ratings: SourceRating[];
}

export interface MotherListItem {
  id: number;
  mother_uid: string;
  mother_name: string;
  village: string | null;
  edd_records: string | null;
  gestational_weeks: number | null;
  created_at: string;
}

export interface Mother extends MotherPayload {
  id: number;
  mother_uid: string;
  registered_by_user_id: number | null;
  created_at: string;
  edd_lmp: string | null;
  gestational_weeks: number | null;
  gestational_months: number | null;
}

export const listMothers = () => client.get<MotherListItem[]>('/api/mothers').then(r => r.data);
export const getMother = (id: number) => client.get<Mother>(`/api/mothers/${id}`).then(r => r.data);
export const createMother = (payload: MotherPayload) => client.post<Mother>('/api/mothers', payload).then(r => r.data);
export const updateMother = (id: number, payload: MotherPayload) =>
  client.put<Mother>(`/api/mothers/${id}`, payload).then(r => r.data);
