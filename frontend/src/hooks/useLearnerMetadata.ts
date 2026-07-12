import { useEffect, useRef, useState } from 'react';
import client from '../api/client';
import type {
  StateOption, DistrictOption, BlockOption, VillageOption, FacilityOption,
  QualificationOption, DepartmentOption, DesignationOption, FacilityTypeOption,
} from '../lib/learnerFields';

export interface LearnerSelection {
  departmentId: number | '';
  designationId: number | '';
  stateId: number | '';
  districtId: number | '';
  blockId: number | '';
}

/**
 * Loads and cascades the Learner-Registration option lists from /api/metadata/*.
 * The caller owns the selection state (and resets dependent fields in its change
 * handlers); this hook only fetches the option lists for the given selection, so
 * it is shared by both the registration wizard and the profile editor.
 */
export function useLearnerMetadata(sel: LearnerSelection, onError?: (msg: string) => void) {
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [designations, setDesignations] = useState<DesignationOption[]>([]);
  const [facilityTypes, setFacilityTypes] = useState<FacilityTypeOption[]>([]);
  const [qualifications, setQualifications] = useState<QualificationOption[]>([]);
  const [states, setStates] = useState<StateOption[]>([]);
  const [districts, setDistricts] = useState<DistrictOption[]>([]);
  const [blocks, setBlocks] = useState<BlockOption[]>([]);
  const [villages, setVillages] = useState<VillageOption[]>([]);
  const [facilities, setFacilities] = useState<FacilityOption[]>([]);

  // Keep the latest onError without re-running effects when the caller re-renders.
  const errRef = useRef(onError);
  errRef.current = onError;
  const fail = (msg: string) => errRef.current?.(msg);

  const { departmentId, designationId, stateId, districtId, blockId } = sel;

  // Mount: top-level lists that never cascade.
  useEffect(() => {
    Promise.all([client.get('/api/metadata/departments'), client.get('/api/metadata/states')])
      .then(([d, s]) => { setDepartments(d.data); setStates(s.data); })
      .catch(() => fail('Failed to load form options'));
  }, []);

  // Department → designations + department-scoped qualifications.
  useEffect(() => {
    if (!departmentId) { setDesignations([]); setQualifications([]); return; }
    Promise.all([
      client.get(`/api/metadata/designations?department_id=${departmentId}`),
      client.get(`/api/metadata/qualifications?department_id=${departmentId}`),
    ])
      .then(([des, q]) => { setDesignations(des.data); setQualifications(q.data); })
      .catch(() => fail('Failed to load designations'));
  }, [departmentId]);

  // Designation → mapped facility types (or all, server decides).
  useEffect(() => {
    if (!designationId) { setFacilityTypes([]); return; }
    client.get(`/api/metadata/facility-types?designation_id=${designationId}`)
      .then(res => setFacilityTypes(res.data)).catch(() => fail('Failed to load facility types'));
  }, [designationId]);

  // State → districts.
  useEffect(() => {
    if (!stateId) { setDistricts([]); return; }
    client.get(`/api/metadata/districts?state_id=${stateId}`)
      .then(res => setDistricts(res.data)).catch(() => fail('Failed to load districts'));
  }, [stateId]);

  // District → blocks (taluks).
  useEffect(() => {
    if (!districtId) { setBlocks([]); return; }
    client.get(`/api/metadata/blocks?district_id=${districtId}`)
      .then(res => setBlocks(res.data)).catch(() => fail('Failed to load taluks'));
  }, [districtId]);

  // Block → villages + facilities.
  useEffect(() => {
    if (!blockId) { setVillages([]); setFacilities([]); return; }
    Promise.all([
      client.get(`/api/metadata/villages?block_id=${blockId}`),
      client.get(`/api/metadata/facilities?block_id=${blockId}`),
    ])
      .then(([v, f]) => { setVillages(v.data); setFacilities(f.data); })
      .catch(() => fail('Failed to load villages & facilities'));
  }, [blockId]);

  return { departments, designations, facilityTypes, qualifications, states, districts, blocks, villages, facilities };
}

export type LearnerMetadata = ReturnType<typeof useLearnerMetadata>;
