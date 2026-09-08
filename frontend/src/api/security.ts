/**
 * Data-protection console API.
 *
 * Mirrors backend/app/routers/admin_security.py. Kept in one module so the
 * shapes the console renders are declared once — the security screens are the
 * ones most likely to be read by someone who is not a developer, and a field
 * that silently goes missing there is worse than a compile error.
 */
import client from './client';

// ── Overview ────────────────────────────────────────────────────────────────

export interface PostureCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface SecurityOverview {
  generated_at: string;
  posture: PostureCheck[];
  encryption: {
    enabled: boolean;
    active_key_version: string | null;
    key_versions: string[];
    decryption_failures: Record<string, number>;
  };
  audit: {
    total_events: number;
    oldest_event: string | null;
    retention_floor_days: number;
    coverage_days: number;
    phi_accesses_24h: number;
    denials_24h: number;
    records_exported_7d: number;
    integrity_valid: boolean;
    integrity_issue_count: number;
    writer: { written: number; queued: number; spilled: number; recovered: number; chain_key: string };
  };
  alerts: { open_total: number; by_severity: Record<string, number> };
  incidents: {
    open: number;
    obligations_pending: number;
    obligations_overdue: number;
    obligations_due_soon: number;
    next_deadlines: {
      incident_reference: string;
      incident_title: string;
      authority: string;
      authority_label: string;
      due_at: string;
      state: string;
      seconds_remaining: number | null;
    }[];
  };
  requests: { open: number; overdue: number };
  access: { live_sessions: number; locked_accounts: number };
  contacts: { organisation: string; dpo_name: string; dpo_email: string; dpo_phone: string };
}

export const getOverview = () =>
  client.get<SecurityOverview>('/api/admin/security/overview').then(r => r.data);

// ── Audit ───────────────────────────────────────────────────────────────────

export interface AuditEvent {
  id: number;
  occurred_at: string;
  actor_type: string;
  actor: string | null;
  actor_id: number | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  subject_type: string | null;
  subject_id: string | null;
  record_count: number;
  is_phi: boolean;
  outcome: string;
  status_code: number | null;
  method: string | null;
  path: string | null;
  source_ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  session_jti: string | null;
  detail: Record<string, unknown>;
  chain_key: string;
  sequence: number;
  entry_hash: string;
}

export interface AuditSearchFilters {
  actor?: string;
  action?: string;
  subject_type?: string;
  subject_id?: string;
  outcome?: string;
  source_ip?: string;
  phi_only?: boolean;
  days?: number;
  limit?: number;
  offset?: number;
}

export const searchAudit = (filters: AuditSearchFilters) =>
  client
    .get<{ total: number; limit: number; offset: number; events: AuditEvent[]; actions: string[] }>(
      '/api/admin/security/audit',
      { params: filters },
    )
    .then(r => r.data);

export interface SubjectHistory {
  subject_type: string;
  subject_id: string;
  total_accesses: number;
  distinct_actors: number;
  actors: { actor: string; actor_type: string; accesses: number; last: string }[];
  events: AuditEvent[];
}

export const subjectHistory = (subjectType: string, subjectId: string) =>
  client
    .get<SubjectHistory>(`/api/admin/security/audit/subject/${subjectType}/${subjectId}`)
    .then(r => r.data);

export interface ChainVerification {
  verified_at: string;
  total_events: number;
  chain_count: number;
  valid: boolean;
  chains: {
    chain_key: string;
    checked: number;
    valid: boolean;
    issue_count: number;
    issues: { type: string; at_id?: number; sequence?: number; meaning?: string }[];
  }[];
  anchors: { checked: number; valid: boolean; issues: unknown[] };
}

export const verifyAudit = () =>
  client.post<ChainVerification>('/api/admin/security/audit/verify').then(r => r.data);

export const auditExportUrl = (filters: AuditSearchFilters) => {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== '' && v !== false) params.set(k, String(v));
  });
  return `/api/admin/security/audit/export?${params.toString()}`;
};

// ── Alerts ──────────────────────────────────────────────────────────────────

export interface SecurityAlert {
  id: number;
  raised_at: string;
  rule: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string | null;
  actor: string | null;
  source_ip: string | null;
  evidence: Record<string, unknown>;
  status: 'open' | 'investigating' | 'dismissed' | 'confirmed';
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolution_note: string | null;
  incident_id: number | null;
}

export const listAlerts = (params: { status?: string; severity?: string; days?: number } = {}) =>
  client
    .get<{ alerts: SecurityAlert[]; total: number }>('/api/admin/security/alerts', { params })
    .then(r => r.data);

export const updateAlert = (id: number, body: { status: string; note?: string }) =>
  client.patch<SecurityAlert>(`/api/admin/security/alerts/${id}`, body).then(r => r.data);

// ── Incidents ───────────────────────────────────────────────────────────────

export interface DeadlineState {
  state: 'pending' | 'due_soon' | 'overdue' | 'met' | 'met_late' | 'not_applicable';
  seconds_remaining: number | null;
  overdue_by: number | null;
}

export interface BreachNotification {
  id: number;
  authority: string;
  authority_label: string;
  legal_basis: string | null;
  due_at: string;
  sent_at: string | null;
  channel: string | null;
  reference_number: string | null;
  sent_by: string | null;
  not_applicable: boolean;
  not_applicable_reason: string | null;
  deadline: DeadlineState;
}

export interface BreachIncident {
  id: number;
  reference: string;
  created_at: string;
  title: string;
  summary: string | null;
  severity: string;
  status: string;
  occurred_at: string | null;
  discovered_at: string;
  contained_at: string | null;
  closed_at: string | null;
  custody_party: string;
  custody_party_label: string | null;
  custody_rationale: string | null;
  controlling_system: string | null;
  fault_assessment: string | null;
  joint_process: boolean;
  categories: string[];
  affected_subject_count: number | null;
  phi_involved: boolean;
  root_cause: string | null;
  remediation: string | null;
  reported_by: string | null;
  owner: string | null;
  notifications: BreachNotification[];
  alerts?: SecurityAlert[];
}

export const listIncidents = (params: { status?: string } = {}) =>
  client
    .get<{ incidents: BreachIncident[]; custody_parties: Record<string, string> }>(
      '/api/admin/security/incidents',
      { params },
    )
    .then(r => r.data);

export const getIncident = (id: number) =>
  client.get<BreachIncident>(`/api/admin/security/incidents/${id}`).then(r => r.data);

export const createIncident = (body: Record<string, unknown>) =>
  client.post<BreachIncident>('/api/admin/security/incidents', body).then(r => r.data);

export const updateIncident = (id: number, body: Record<string, unknown>) =>
  client.patch<BreachIncident>(`/api/admin/security/incidents/${id}`, body).then(r => r.data);

export interface CustodyEvidence {
  window: { from: string; to: string };
  actors: { actor_type: string; actor: string; events: number; records: number; distinct_addresses: number }[];
  source_addresses: { ip: string; events: number }[];
  exports: { audit_event_id: number; at: string; actor: string; records: number; path: string; source_ip: string }[];
  audit_trail_intact: boolean;
  audit_events_in_window: number;
  note: string;
}

export const incidentEvidence = (id: number, windowHours = 24) =>
  client
    .get<CustodyEvidence>(`/api/admin/security/incidents/${id}/evidence`, {
      params: { window_hours: windowHours },
    })
    .then(r => r.data);

export const notificationDraft = (id: number, authority: string) =>
  client
    .get<{ authority: string; authority_label: string; legal_basis: string; due_at: string; deadline: DeadlineState; draft: string }>(
      `/api/admin/security/incidents/${id}/notifications/${authority}/draft`,
    )
    .then(r => r.data);

export const markNotificationSent = (
  id: number,
  authority: string,
  body: { channel?: string; reference_number?: string; content?: string },
) =>
  client
    .post<BreachNotification>(`/api/admin/security/incidents/${id}/notifications/${authority}/sent`, body)
    .then(r => r.data);

export const markNotificationNotApplicable = (id: number, authority: string, reason: string) =>
  client
    .post<BreachNotification>(
      `/api/admin/security/incidents/${id}/notifications/${authority}/not-applicable`,
      { reason },
    )
    .then(r => r.data);

// ── Containment ─────────────────────────────────────────────────────────────

export const revokeSessions = (body: {
  scope: 'principal' | 'all';
  principal?: string;
  reason?: string;
  incident_id?: number;
}) => client.post<{ sessions_ended: number; scope: string }>('/api/admin/security/containment/revoke-sessions', body).then(r => r.data);

export interface LiveSession {
  id: number;
  jti: string;
  principal: string;
  is_admin: boolean;
  issued_at: string;
  expires_at: string;
  last_seen_at: string | null;
  source_ip: string | null;
  user_agent: string | null;
  mfa_satisfied: boolean;
}

export const listSessions = (principal?: string) =>
  client
    .get<{ sessions: LiveSession[] }>('/api/admin/security/sessions', { params: { principal } })
    .then(r => r.data);

export const endSession = (jti: string) =>
  client.delete(`/api/admin/security/sessions/${jti}`).then(r => r.data);

export interface Lockout {
  id: number;
  principal: string;
  locked_at: string;
  locked_until: string;
  seconds_remaining: number;
  failure_count: number;
  reason: string;
}

export const listLockouts = () =>
  client.get<{ lockouts: Lockout[] }>('/api/admin/security/lockouts').then(r => r.data);

export const clearLockout = (principal: string) =>
  client.post(`/api/admin/security/lockouts/${encodeURIComponent(principal)}/clear`).then(r => r.data);

// ── MFA ─────────────────────────────────────────────────────────────────────

export interface MfaStatus {
  principal: string;
  enrolled: boolean;
  pending: boolean;
  confirmed_at: string | null;
  last_used_at: string | null;
  recovery_codes_remaining: number;
  required: boolean;
}

export const mfaStatus = () =>
  client.get<MfaStatus>('/api/admin/security/mfa/status').then(r => r.data);

export const mfaEnroll = () =>
  client
    .post<{ secret: string; secret_formatted: string; otpauth_uri: string; issuer: string; account: string }>(
      '/api/admin/security/mfa/enroll',
    )
    .then(r => r.data);

export const mfaConfirm = (code: string) =>
  client
    .post<{ recovery_codes: string[]; confirmed_at: string }>('/api/admin/security/mfa/confirm', { code })
    .then(r => r.data);

export const mfaDisable = (principal: string) =>
  client.post('/api/admin/security/mfa/disable', { principal }).then(r => r.data);

export const mfaAdministrators = () =>
  client
    .get<{ required: boolean; administrators: (Omit<MfaStatus, 'principal'> & { email: string; full_name: string })[] }>(
      '/api/admin/security/mfa/administrators',
    )
    .then(r => r.data);

// ── Retention & ROPA ────────────────────────────────────────────────────────

export interface RetentionPolicy {
  id: number;
  key: string;
  label: string;
  description: string | null;
  retention_days: number;
  action: 'delete' | 'anonymise' | 'review';
  enabled: boolean;
  legal_basis: string | null;
  last_run_at: string | null;
  last_run_rows: number | null;
}

export const listRetention = () =>
  client
    .get<{ cert_in_log_floor_days: number; policies: RetentionPolicy[] }>('/api/admin/security/retention')
    .then(r => r.data);

export const updateRetention = (key: string, body: Partial<RetentionPolicy>) =>
  client.put(`/api/admin/security/retention/${key}`, body).then(r => r.data);

export const runRetention = (dryRun: boolean, only?: string) =>
  client
    .post<{ dry_run: boolean; total_deleted: number; policies: Record<string, Record<string, unknown>> }>(
      '/api/admin/security/retention/run',
      { dry_run: dryRun, only },
    )
    .then(r => r.data);

export interface ProcessingActivity {
  id: number;
  key: string;
  name: string;
  purpose: string;
  lawful_basis: string;
  data_categories: string[];
  special_category: boolean;
  subject_categories: string[];
  recipients: string[];
  storage_location: string | null;
  cross_border: boolean;
  retention_months: number | null;
  retention_rationale: string | null;
  security_measures: string[];
  controller: string | null;
  processor: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

export const listRopa = () =>
  client.get<{ activities: ProcessingActivity[] }>('/api/admin/security/ropa').then(r => r.data);

// ── Consent ─────────────────────────────────────────────────────────────────

export interface ConsentSummary {
  notice_version: string;
  subjects: { mothers: number; children: number };
  records: { subject_type: string; purpose: string; granted: number; withdrawn: number; total: number }[];
  purposes: Record<string, { label: string; essential: boolean }>;
}

export const consentSummary = () =>
  client.get<ConsentSummary>('/api/admin/security/consent').then(r => r.data);

// ── Data-principal rights ───────────────────────────────────────────────────

export interface DataSubjectRequest {
  id: number;
  reference: string;
  created_at: string;
  request_type: string;
  subject_type: string;
  subject_id: number | null;
  subject_identifier: string | null;
  requested_by: string | null;
  requester_relationship: string | null;
  identity_verified: boolean;
  verification_method: string | null;
  details: string | null;
  status: string;
  due_at: string;
  overdue: boolean;
  days_remaining: number | null;
  closed_at: string | null;
  outcome: string | null;
  rejection_reason: string | null;
  handled_by: string | null;
  response_ref: string | null;
}

export const listRequests = (params: { status?: string; overdue_only?: boolean } = {}) =>
  client
    .get<{ requests: DataSubjectRequest[]; response_days: number; types: string[] }>(
      '/api/admin/security/requests',
      { params },
    )
    .then(r => r.data);

export const createRequest = (body: Record<string, unknown>) =>
  client.post<DataSubjectRequest>('/api/admin/security/requests', body).then(r => r.data);

export const updateRequest = (id: number, body: Record<string, unknown>) =>
  client.patch<DataSubjectRequest>(`/api/admin/security/requests/${id}`, body).then(r => r.data);

export const accessBundle = (id: number) =>
  client.get<Record<string, unknown>>(`/api/admin/security/requests/${id}/bundle`).then(r => r.data);

export const fulfilErasure = (
  id: number,
  body: { method: 'hard_delete' | 'anonymise'; confirm_reference: string; note?: string },
) => client.post(`/api/admin/security/requests/${id}/erase`, body).then(r => r.data);

export interface ErasureRecord {
  id: number;
  performed_at: string;
  trigger: string;
  subject_type: string | null;
  subject_uid: string | null;
  scope: Record<string, number>;
  rows_deleted: number;
  method: string;
  content_digest: string | null;
  performed_by: string | null;
  note: string | null;
}

export const listErasures = () =>
  client.get<{ erasures: ErasureRecord[] }>('/api/admin/security/erasures').then(r => r.data);
