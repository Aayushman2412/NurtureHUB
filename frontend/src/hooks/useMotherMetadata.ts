import { useEffect, useRef, useState } from 'react';
import client from '../api/client';

export interface StateOpt { id: number; name: string; }
export interface DistrictOpt { id: number; state_id: number; name: string; }
export interface BlockOpt { id: number; district_id: number; name: string; }
export interface HWCOpt { id: number; name: string; block_id: number | null; phc_id: number | null; }
export interface PHCOpt { id: number; name: string; block_id: number | null; }
export interface EducationLevelOpt { id: number; name: string; order_index: number; requires_field: boolean; }
export interface EducationFieldOpt { id: number; name: string; order_index: number; }
export interface EducationDegreeOpt { id: number; field_id: number; name: string; order_index: number; }

export interface MotherSelection {
  stateId: number | '';
  districtId: number | '';
  talukId: number | '';
  hwcId: number | '';
  educationFieldId: number | '';
}

/**
 * Loads and cascades the Mother-Registration option lists. State→District→Taluk→HWC,
 * HWC→PHC (auto-populates the single mapped PHC), and education field→degree. The
 * caller owns the selection state and resets dependents in its change handlers.
 */
export function useMotherMetadata(sel: MotherSelection, onError?: (msg: string) => void) {
  const [states, setStates] = useState<StateOpt[]>([]);
  const [districts, setDistricts] = useState<DistrictOpt[]>([]);
  const [taluks, setTaluks] = useState<BlockOpt[]>([]);
  const [hwcs, setHwcs] = useState<HWCOpt[]>([]);
  const [phc, setPhc] = useState<PHCOpt | null>(null);   // the one PHC an HWC maps to
  const [educationLevels, setEducationLevels] = useState<EducationLevelOpt[]>([]);
  const [educationFields, setEducationFields] = useState<EducationFieldOpt[]>([]);
  const [educationDegrees, setEducationDegrees] = useState<EducationDegreeOpt[]>([]);

  const errRef = useRef(onError);
  errRef.current = onError;
  const fail = (msg: string) => errRef.current?.(msg);

  const { stateId, districtId, talukId, hwcId, educationFieldId } = sel;

  useEffect(() => {
    Promise.all([
      client.get('/api/metadata/states'),
      client.get('/api/metadata/education-levels'),
      client.get('/api/metadata/education-fields'),
    ])
      .then(([s, l, f]) => { setStates(s.data); setEducationLevels(l.data); setEducationFields(f.data); })
      .catch(() => fail('Failed to load form options'));
  }, []);

  useEffect(() => {
    if (!stateId) { setDistricts([]); return; }
    client.get(`/api/metadata/districts?state_id=${stateId}`)
      .then(r => setDistricts(r.data)).catch(() => fail('Failed to load districts'));
  }, [stateId]);

  useEffect(() => {
    if (!districtId) { setTaluks([]); return; }
    client.get(`/api/metadata/blocks?district_id=${districtId}`)
      .then(r => setTaluks(r.data)).catch(() => fail('Failed to load taluks'));
  }, [districtId]);

  useEffect(() => {
    if (!talukId) { setHwcs([]); return; }
    client.get(`/api/metadata/hwcs?block_id=${talukId}`)
      .then(r => setHwcs(r.data)).catch(() => fail('Failed to load HWCs'));
  }, [talukId]);

  // HWC → its single PHC (auto-populate).
  useEffect(() => {
    if (!hwcId) { setPhc(null); return; }
    client.get(`/api/metadata/phcs?hwc_id=${hwcId}`)
      .then(r => setPhc(r.data[0] ?? null)).catch(() => fail('Failed to load PHC'));
  }, [hwcId]);

  useEffect(() => {
    if (!educationFieldId) { setEducationDegrees([]); return; }
    client.get(`/api/metadata/education-degrees?field_id=${educationFieldId}`)
      .then(r => setEducationDegrees(r.data)).catch(() => fail('Failed to load degrees'));
  }, [educationFieldId]);

  return { states, districts, taluks, hwcs, phc, educationLevels, educationFields, educationDegrees };
}

export type MotherMetadata = ReturnType<typeof useMotherMetadata>;
