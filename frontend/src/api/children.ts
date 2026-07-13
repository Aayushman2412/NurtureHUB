import client from './client';

export interface BirthCondition {
  condition: string;
}

/** Payload for create/update — mirrors the backend ChildCreate schema. */
export interface ChildPayload {
  babies_born?: string | null;
  adoption_date?: string | null;
  child_name: string;
  dob?: string | null;
  birth_weight?: number | null;
  birth_length?: number | null;
  gender?: string | null;
  previous_living_children?: number | null;
  delivery_method?: string | null;
  delivery_place?: string | null;
  delivery_place_other?: string | null;
  bf_within_one_hour?: boolean | null;
  ebf_during_stay?: boolean | null;
  ebf_reason?: string | null;
  pre_existing_other?: string | null;
  birth_conditions: BirthCondition[];
}

export interface ChildListItem {
  id: number;
  child_uid: string;
  child_name: string;
  gender: string | null;
  dob: string | null;
  birth_weight: number | null;
  age_months: number | null;
  created_at: string;
}

export interface Child extends ChildPayload {
  id: number;
  child_uid: string;
  mother_id: number;
  created_at: string;
  age_days: number | null;
  age_months: number | null;
}

// Children are nested under an owned mother.
export const listChildren = (motherId: number) =>
  client.get<ChildListItem[]>(`/api/mothers/${motherId}/children`).then(r => r.data);
export const getChild = (motherId: number, childId: number) =>
  client.get<Child>(`/api/mothers/${motherId}/children/${childId}`).then(r => r.data);
export const createChild = (motherId: number, payload: ChildPayload) =>
  client.post<Child>(`/api/mothers/${motherId}/children`, payload).then(r => r.data);
export const updateChild = (motherId: number, childId: number, payload: ChildPayload) =>
  client.put<Child>(`/api/mothers/${motherId}/children/${childId}`, payload).then(r => r.data);
