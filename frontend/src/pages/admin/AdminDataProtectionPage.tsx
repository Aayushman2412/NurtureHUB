/**
 * Data Protection console.
 *
 * One screen an administrator can be asked to open in front of a government
 * counterparty and answer from. The ordering is deliberate: anything with a
 * statutory clock running comes first, because the two obligations that apply
 * here — six hours to CERT-In, and the DPDP intimation — are measured from the
 * moment someone became aware, not from the moment they got round to it.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, Database, Download, Eye, FileText, Fingerprint,
  KeyRound, Lock, RefreshCw, Search, ShieldAlert, ShieldCheck, Siren, Trash2, Unlock, UserX,
} from 'lucide-react';
import AdminLayout from '../../components/layout/AdminLayout';
import {
  Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader,
  Select, Spinner, StatCard, TBody, THead, Table, Tabs, Td, Th, Tr,
} from '../../components/ui';
import { useToast } from '../../context/ToastContext';
import { API_BASE_URL } from '../../api/config';
import * as api from '../../api/security';
import { cn } from '../../utils/cn';

type TabKey = 'overview' | 'audit' | 'alerts' | 'incidents' | 'access' | 'governance';

const SEVERITY_BADGE: Record<string, 'error' | 'warning' | 'info' | 'neutral'> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'info',
};

/** A countdown that reads like a deadline, not a duration. */
const formatRemaining = (seconds: number | null): string => {
  if (seconds === null) return '—';
  if (seconds <= 0) return 'overdue';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const formatDateTime = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const DEADLINE_TONE: Record<string, string> = {
  overdue: 'text-error-600 dark:text-error-500 font-bold',
  due_soon: 'text-amber-700 dark:text-amber-500 font-semibold',
  pending: 'text-ink-muted',
  met: 'text-success-600 dark:text-success-500',
  met_late: 'text-amber-700 dark:text-amber-500',
  not_applicable: 'text-ink-muted',
};

const AdminDataProtectionPage: React.FC = () => {
  const { showToast } = useToast();
  const [tab, setTab] = useState<TabKey>('overview');
  const [overview, setOverview] = useState<api.SecurityOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await api.getOverview());
    } catch {
      showToast('Could not load the data-protection overview.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const openObligations = overview?.incidents.obligations_overdue ?? 0;
  const openAlerts = overview?.alerts.open_total ?? 0;
  const overdueRequests = overview?.requests.overdue ?? 0;

  const tabs = useMemo(
    () => [
      { value: 'overview' as const, label: 'Overview', icon: <ShieldCheck className="size-4" /> },
      { value: 'audit' as const, label: 'Access log', icon: <Eye className="size-4" /> },
      {
        value: 'alerts' as const,
        label: openAlerts ? `Alerts (${openAlerts})` : 'Alerts',
        icon: <ShieldAlert className="size-4" />,
      },
      {
        value: 'incidents' as const,
        label: openObligations ? `Breaches (${openObligations} overdue)` : 'Breaches',
        icon: <Siren className="size-4" />,
      },
      { value: 'access' as const, label: 'Access control', icon: <KeyRound className="size-4" /> },
      {
        value: 'governance' as const,
        label: overdueRequests ? `Governance (${overdueRequests})` : 'Governance',
        icon: <FileText className="size-4" />,
      },
    ],
    [openAlerts, openObligations, overdueRequests],
  );

  return (
    <AdminLayout>
      <PageHeader
        title="Data Protection"
        description="Audit trail, breach register and statutory obligations for the patient records this platform holds."
        actions={
          <Button variant="ghost" onClick={() => void loadOverview()}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        }
      />

      <Tabs value={tab} onChange={setTab} items={tabs} className="mb-6" />

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <>
          {tab === 'overview' && <OverviewTab overview={overview} onGoTo={setTab} />}
          {tab === 'audit' && <AuditTab />}
          {tab === 'alerts' && <AlertsTab onChanged={loadOverview} />}
          {tab === 'incidents' && <IncidentsTab onChanged={loadOverview} />}
          {tab === 'access' && <AccessTab onChanged={loadOverview} />}
          {tab === 'governance' && <GovernanceTab onChanged={loadOverview} />}
        </>
      )}
    </AdminLayout>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Overview
// ═══════════════════════════════════════════════════════════════════════════

const OverviewTab: React.FC<{
  overview: api.SecurityOverview | null;
  onGoTo: (tab: TabKey) => void;
}> = ({ overview, onGoTo }) => {
  if (!overview) return <EmptyState title="No data" description="The overview could not be loaded." />;

  const failing = overview.posture.filter(p => !p.ok);
  const deadlines = overview.incidents.next_deadlines;

  return (
    <div className="@container flex flex-col gap-6">
      {/* Statutory clocks first — nothing on this page matters more. */}
      {deadlines.length > 0 && (
        <Card className="p-5 border-l-4 border-l-error-500">
          <h3 className="font-display font-bold text-lg text-ink flex items-center gap-2 mb-1">
            <Clock className="size-5 text-error-600" /> Reporting deadlines running
          </h3>
          <p className="text-sm text-ink-muted mb-4">
            Measured from when the breach was discovered, which is when the law starts counting.
          </p>
          <Table density="compact" className="[&_td]:align-top [&_th]:align-bottom">
            <THead>
              <Tr>
                <Th>Incident</Th>
                <Th>Must be notified to</Th>
                <Th>Due</Th>
                <Th>Time left</Th>
              </Tr>
            </THead>
            <TBody>
              {deadlines.map(d => (
                <Tr key={`${d.incident_reference}-${d.authority}`}>
                  <Td>
                    <button
                      className="font-semibold text-primary-ink hover:underline"
                      onClick={() => onGoTo('incidents')}
                    >
                      {d.incident_reference}
                    </button>
                    <div className="text-xs text-ink-muted">{d.incident_title}</div>
                  </Td>
                  <Td>{d.authority_label}</Td>
                  <Td>{formatDateTime(d.due_at)}</Td>
                  <Td className={DEADLINE_TONE[d.state]}>{formatRemaining(d.seconds_remaining)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <div className="grid grid-cols-1 @md:grid-cols-2 @5xl:grid-cols-4 gap-4">
        <StatCard
          icon={<Eye className="size-5" />}
          label="Patient records opened (24h)"
          value={overview.audit.phi_accesses_24h.toLocaleString()}
          tone="coral"
          wrapLabel
        />
        <StatCard
          icon={<Download className="size-5" />}
          label="Records exported (7 days)"
          value={overview.audit.records_exported_7d.toLocaleString()}
          tone={overview.audit.records_exported_7d > 0 ? 'amber' : 'neutral'}
          wrapLabel
        />
        <StatCard
          icon={<ShieldAlert className="size-5" />}
          label="Open alerts"
          value={overview.alerts.open_total}
          tone={overview.alerts.open_total ? 'amber' : 'sage'}
          wrapLabel
        />
        <StatCard
          icon={<UserX className="size-5" />}
          label="Access refused (24h)"
          value={overview.audit.denials_24h}
          tone={overview.audit.denials_24h > 20 ? 'amber' : 'neutral'}
          wrapLabel
        />
      </div>

      <div className="grid grid-cols-1 @4xl:grid-cols-2 gap-6">
        {/* Integrity: the claim everything else rests on. */}
        <Card className="p-5">
          <h3 className="font-display font-bold text-lg text-ink flex items-center gap-2 mb-3">
            <Fingerprint className="size-5" /> Audit trail integrity
          </h3>
          {overview.audit.integrity_valid ? (
            <Alert variant="success">
              The access log verifies against its cryptographic signatures. Nothing has been altered
              or removed since it was written.
            </Alert>
          ) : (
            <Alert variant="error">
              <strong>The access log failed verification</strong> — {overview.audit.integrity_issue_count}{' '}
              issue(s). Either rows were changed outside the application or the signing key changed.
              Treat this as an incident until it is explained.
            </Alert>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-muted">Events recorded</dt>
            <dd className="text-ink font-semibold">{overview.audit.total_events.toLocaleString()}</dd>
            <dt className="text-ink-muted">History covers</dt>
            <dd className="text-ink font-semibold">
              {overview.audit.coverage_days} days
              {overview.audit.coverage_days < overview.audit.retention_floor_days && (
                <span className="text-ink-muted font-normal">
                  {' '}
                  (CERT-In floor: {overview.audit.retention_floor_days})
                </span>
              )}
            </dd>
            <dt className="text-ink-muted">Oldest event</dt>
            <dd className="text-ink">{formatDateTime(overview.audit.oldest_event)}</dd>
            <dt className="text-ink-muted">Unwritten events</dt>
            <dd className={cn('font-semibold', overview.audit.writer.spilled ? 'text-amber-700' : 'text-ink')}>
              {overview.audit.writer.spilled || 0}
            </dd>
          </dl>
        </Card>

        <Card className="p-5">
          <h3 className="font-display font-bold text-lg text-ink flex items-center gap-2 mb-3">
            <Lock className="size-5" /> Protective controls
          </h3>
          <ul className="flex flex-col divide-y divide-border">
            {overview.posture.map(check => (
              <li key={check.key} className="flex items-start gap-3 py-2.5">
                {check.ok ? (
                  <CheckCircle2 className="size-4 shrink-0 mt-0.5 text-success-600" />
                ) : (
                  <AlertTriangle
                    className={cn(
                      'size-4 shrink-0 mt-0.5',
                      check.severity === 'critical' ? 'text-error-600' : 'text-amber-600',
                    )}
                  />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink">{check.label}</div>
                  <div className="text-[13px] text-ink-muted">{check.detail}</div>
                </div>
              </li>
            ))}
          </ul>
          {failing.length > 0 && (
            <p className="mt-3 text-[13px] text-ink-muted">
              Controls above are set by environment configuration on the server, not from this
              screen — deliberately, so that turning one off leaves a trace in the deployment.
            </p>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="font-display font-bold text-lg text-ink flex items-center gap-2 mb-3">
          <Database className="size-5" /> Encryption at rest
        </h3>
        {overview.encryption.enabled ? (
          <p className="text-sm text-ink">
            Contact identifiers (mothers' and learners' phone numbers and email addresses) are sealed
            with AES-256-GCM. Active key version{' '}
            <code className="px-1.5 py-0.5 rounded bg-surface-sunken text-[13px]">
              {overview.encryption.active_key_version}
            </code>
            ; {overview.encryption.key_versions.length} version(s) readable.
          </p>
        ) : (
          <Alert variant="error">
            No encryption key is configured — contact details are stored in plain text. Set
            PHI_ENCRYPTION_KEYS and run <code>scripts/encrypt_phi.py</code>.
          </Alert>
        )}
        {Object.keys(overview.encryption.decryption_failures).length > 0 && (
          <Alert variant="warning" className="mt-3">
            Some values could not be decrypted:{' '}
            {Object.entries(overview.encryption.decryption_failures)
              .map(([col, n]) => `${col} (${n})`)
              .join(', ')}
            . This is almost always a key-rotation mistake — check that every key version that was
            ever used is still listed in PHI_ENCRYPTION_KEYS.
          </Alert>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="font-display font-bold text-base text-ink mb-2">Accountable contact</h3>
        <p className="text-sm text-ink-muted">
          {overview.contacts.organisation} · {overview.contacts.dpo_name} ·{' '}
          <a href={`mailto:${overview.contacts.dpo_email}`} className="text-primary-ink hover:underline">
            {overview.contacts.dpo_email}
          </a>
          {overview.contacts.dpo_phone ? ` · ${overview.contacts.dpo_phone}` : ''}
        </p>
      </Card>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Access log
// ═══════════════════════════════════════════════════════════════════════════

const AuditTab: React.FC = () => {
  const { showToast } = useToast();
  const [filters, setFilters] = useState<api.AuditSearchFilters>({ days: 7, limit: 100, offset: 0 });
  const [data, setData] = useState<Awaited<ReturnType<typeof api.searchAudit>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<api.AuditEvent | null>(null);
  const [verification, setVerification] = useState<api.ChainVerification | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api.searchAudit(filters));
    } catch {
      showToast('Could not load the access log.', 'error');
    } finally {
      setBusy(false);
    }
  }, [filters, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const runVerify = async () => {
    setBusy(true);
    try {
      const result = await api.verifyAudit();
      setVerification(result);
      showToast(
        result.valid
          ? `Verified ${result.total_events.toLocaleString()} events — the log is intact.`
          : 'The log FAILED verification. See the detail below.',
        result.valid ? 'success' : 'error',
      );
    } catch {
      showToast('Verification could not be run.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const set = (patch: Partial<api.AuditSearchFilters>) =>
    setFilters(f => ({ ...f, ...patch, offset: 0 }));

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <Field label="Who">
            <Input
              placeholder="email address"
              value={filters.actor ?? ''}
              onChange={e => set({ actor: e.target.value })}
            />
          </Field>
          <Field label="Action">
            <Select value={filters.action ?? ''} onChange={e => set({ action: e.target.value })}>
              <option value="">Any action</option>
              {(data?.actions ?? []).map(a => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Outcome">
            <Select value={filters.outcome ?? ''} onChange={e => set({ outcome: e.target.value })}>
              <option value="">Any</option>
              <option value="success">Success</option>
              <option value="denied">Refused</option>
              <option value="error">Error</option>
            </Select>
          </Field>
          <Field label="Period">
            <Select value={String(filters.days ?? 7)} onChange={e => set({ days: Number(e.target.value) })}>
              <option value="1">Last 24 hours</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="400">Everything retained</option>
            </Select>
          </Field>
          <Field label="Patient data only">
            <Select
              value={filters.phi_only ? '1' : ''}
              onChange={e => set({ phi_only: e.target.value === '1' })}
            >
              <option value="">All events</option>
              <option value="1">Patient records only</option>
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <Button onClick={() => void load()} loading={busy}>
            <Search className="size-4" /> Search
          </Button>
          <Button variant="ghost" onClick={() => void runVerify()} loading={busy}>
            <Fingerprint className="size-4" /> Verify integrity
          </Button>
          <a
            href={`${API_BASE_URL}${api.auditExportUrl({ ...filters, days: filters.days ?? 30 })}`}
            className="inline-flex items-center gap-2 text-sm font-semibold text-primary-ink hover:underline"
          >
            <Download className="size-4" /> Export as CSV
          </a>
          {data && (
            <span className="text-sm text-ink-muted ml-auto">
              {data.total.toLocaleString()} event(s)
            </span>
          )}
        </div>
      </Card>

      {verification && (
        <Alert variant={verification.valid ? 'success' : 'error'}>
          <div className="font-semibold">
            {verification.valid
              ? `Intact — ${verification.total_events.toLocaleString()} events across ${verification.chain_count} chain(s) verify against their signatures.`
              : 'The log does not verify.'}
          </div>
          {!verification.valid && (
            <ul className="mt-2 list-disc pl-5 text-sm">
              {verification.chains
                .filter(c => !c.valid)
                .flatMap(c => c.issues)
                .slice(0, 10)
                .map((issue, i) => (
                  <li key={i}>
                    <code>{issue.type}</code> at event {issue.at_id} — {issue.meaning}
                  </li>
                ))}
            </ul>
          )}
        </Alert>
      )}

      {data && data.events.length === 0 ? (
        <EmptyState
          title="Nothing recorded in this window"
          description="Widen the period, or clear the filters."
        />
      ) : (
        <Table density="compact" className="[&_td]:align-top [&_th]:align-bottom">
          <THead>
            <Tr>
              <Th>When</Th>
              <Th>Who</Th>
              <Th>Did what</Th>
              <Th>To whose record</Th>
              <Th>From</Th>
              <Th />
            </Tr>
          </THead>
          <TBody>
            {(data?.events ?? []).map(e => (
              <Tr key={e.id} clickable onClick={() => setSelected(e)}>
                <Td className="whitespace-nowrap text-ink-muted">{formatDateTime(e.occurred_at)}</Td>
                <Td>
                  <div className="font-medium text-ink">{e.actor ?? '—'}</div>
                  <div className="text-xs text-ink-muted">{e.actor_type}</div>
                </Td>
                <Td>
                  <code className="text-[12px] leading-5">{e.action}</code>
                  {e.record_count > 1 && (
                    <span className="ml-1.5 text-xs text-ink-muted">×{e.record_count}</span>
                  )}
                  {e.outcome !== 'success' && (
                    <Badge variant={e.outcome === 'denied' ? 'warning' : 'error'} className="ml-2">
                      {e.outcome}
                    </Badge>
                  )}
                </Td>
                <Td className="text-ink-muted">
                  {e.subject_type ? `${e.subject_type}${e.subject_id ? ` #${e.subject_id}` : ''}` : '—'}
                </Td>
                <Td className="text-ink-muted whitespace-nowrap">{e.source_ip ?? '—'}</Td>
                <Td className="text-right align-middle">
                  {e.is_phi && <Badge variant="coral">patient data</Badge>}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      {data && data.total > (filters.limit ?? 100) && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="ghost"
            disabled={(filters.offset ?? 0) === 0}
            onClick={() => setFilters(f => ({ ...f, offset: Math.max((f.offset ?? 0) - (f.limit ?? 100), 0) }))}
          >
            Previous
          </Button>
          <span className="text-sm text-ink-muted">
            {(filters.offset ?? 0) + 1}–{Math.min((filters.offset ?? 0) + (filters.limit ?? 100), data.total)} of{' '}
            {data.total.toLocaleString()}
          </span>
          <Button
            variant="ghost"
            disabled={(filters.offset ?? 0) + (filters.limit ?? 100) >= data.total}
            onClick={() => setFilters(f => ({ ...f, offset: (f.offset ?? 0) + (f.limit ?? 100) }))}
          >
            Next
          </Button>
        </div>
      )}

      <Modal open={!!selected} onClose={() => setSelected(null)} title="Access log entry" size="lg">
        {selected && (
          <div className="flex flex-col gap-3 text-sm">
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
              <dt className="text-ink-muted">When</dt>
              <dd className="text-ink">{formatDateTime(selected.occurred_at)}</dd>
              <dt className="text-ink-muted">Who</dt>
              <dd className="text-ink">
                {selected.actor ?? '—'} ({selected.actor_type})
              </dd>
              <dt className="text-ink-muted">Action</dt>
              <dd className="text-ink">
                <code>{selected.action}</code> — {selected.outcome}
              </dd>
              <dt className="text-ink-muted">Record</dt>
              <dd className="text-ink">
                {selected.resource_type ?? '—'} {selected.resource_id ?? ''}
              </dd>
              <dt className="text-ink-muted">Data principal</dt>
              <dd className="text-ink">
                {selected.subject_type
                  ? `${selected.subject_type} #${selected.subject_id ?? '?'}`
                  : 'not record-specific'}
              </dd>
              <dt className="text-ink-muted">Request</dt>
              <dd className="text-ink">
                {selected.method} {selected.path} → {selected.status_code ?? '—'}
              </dd>
              <dt className="text-ink-muted">From</dt>
              <dd className="text-ink">{selected.source_ip ?? '—'}</dd>
              <dt className="text-ink-muted">Browser</dt>
              <dd className="text-ink break-all">{selected.user_agent ?? '—'}</dd>
              <dt className="text-ink-muted">Request id</dt>
              <dd className="text-ink font-mono text-xs">{selected.request_id ?? '—'}</dd>
            </dl>
            <div>
              <div className="text-ink-muted mb-1">Detail (identifiers redacted at write time)</div>
              <pre className="rounded-lg bg-surface-sunken p-3 text-xs overflow-x-auto">
                {JSON.stringify(selected.detail, null, 2)}
              </pre>
            </div>
            <div>
              <div className="text-ink-muted mb-1">Signature</div>
              <p className="text-xs text-ink-muted">
                Chain <code>{selected.chain_key}</code>, position {selected.sequence}
              </p>
              <code className="block break-all text-[11px] text-ink-muted mt-1">
                {selected.entry_hash}
              </code>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Alerts
// ═══════════════════════════════════════════════════════════════════════════

const AlertsTab: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const { showToast } = useToast();
  const [alerts, setAlerts] = useState<api.SecurityAlert[]>([]);
  const [statusFilter, setStatusFilter] = useState('open');
  const [triaging, setTriaging] = useState<api.SecurityAlert | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.listAlerts({ status: statusFilter || undefined, days: 90 });
      setAlerts(res.alerts);
    } catch {
      showToast('Could not load alerts.', 'error');
    }
  }, [statusFilter, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const triage = async (status: string) => {
    if (!triaging) return;
    if (status === 'dismissed' && !note.trim()) {
      showToast('Say why this is being dismissed — it becomes part of the record.', 'warning');
      return;
    }
    setBusy(true);
    try {
      await api.updateAlert(triaging.id, { status, note: note.trim() || undefined });
      showToast('Alert updated.', 'success');
      setTriaging(null);
      setNote('');
      await load();
      onChanged();
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Could not update the alert.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="max-w-48">
          <option value="open">Open</option>
          <option value="investigating">Being investigated</option>
          <option value="confirmed">Confirmed</option>
          <option value="dismissed">Dismissed</option>
          <option value="">All</option>
        </Select>
      </div>

      {alerts.length === 0 ? (
        <EmptyState
          title="Nothing needs attention"
          description="The detection rules have not flagged anything in this state."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {alerts.map(alert => (
            <Card key={alert.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={SEVERITY_BADGE[alert.severity] ?? 'neutral'}>{alert.severity}</Badge>
                    <code className="text-xs text-ink-muted">{alert.rule}</code>
                    <span className="text-xs text-ink-muted">{formatDateTime(alert.raised_at)}</span>
                  </div>
                  <h4 className="font-semibold text-ink mt-1.5">{alert.title}</h4>
                  {alert.description && (
                    <p className="text-sm text-ink-muted mt-1">{alert.description}</p>
                  )}
                  {alert.resolution_note && (
                    <p className="text-sm text-ink-muted mt-1 italic">
                      {alert.acknowledged_by}: {alert.resolution_note}
                    </p>
                  )}
                </div>
                {(alert.status === 'open' || alert.status === 'investigating') && (
                  <Button variant="ghost" onClick={() => { setTriaging(alert); setNote(''); }}>
                    Triage
                  </Button>
                )}
              </div>
              {Object.keys(alert.evidence).length > 0 && (
                <pre className="mt-3 rounded-lg bg-surface-sunken p-2.5 text-xs overflow-x-auto">
                  {JSON.stringify(alert.evidence, null, 2)}
                </pre>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!triaging} onClose={() => setTriaging(null)} title="Triage alert">
        {triaging && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink">{triaging.title}</p>
            <Field label="What did you find?">
              <textarea
                className="w-full rounded-lg border border-border bg-surface p-3 text-sm"
                rows={4}
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="e.g. Confirmed with the supervisor — she was preparing the monthly review."
              />
              <p className="mt-1.5 text-xs text-ink-muted">
                Recorded against the alert. A dismissal with no explanation is itself a finding after
                an incident.
              </p>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" loading={busy} onClick={() => void triage('investigating')}>
                Investigating
              </Button>
              <Button variant="ghost" loading={busy} onClick={() => void triage('dismissed')}>
                Expected — dismiss
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void triage('confirmed')}>
                <Siren className="size-4" /> Confirm as a real incident
              </Button>
            </div>
            <p className="text-[13px] text-ink-muted">
              Confirming does not open a breach incident on its own — do that from the Breaches tab so
              the notification deadlines are created with it.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Breach register
// ═══════════════════════════════════════════════════════════════════════════

const IncidentsTab: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const { showToast } = useToast();
  const [incidents, setIncidents] = useState<api.BreachIncident[]>([]);
  const [custodyParties, setCustodyParties] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<api.BreachIncident | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.listIncidents();
      setIncidents(res.incidents);
      setCustodyParties(res.custody_parties);
    } catch {
      showToast('Could not load the breach register.', 'error');
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted max-w-2xl">
          Opening an incident starts the statutory clocks immediately — six hours to CERT-In, and the
          DPDP intimation to the Data Protection Board and to each affected data principal. Open it as
          soon as you suspect, not once you are sure.
        </p>
        <Button variant="danger" onClick={() => setCreating(true)}>
          <Siren className="size-4" /> Report a breach
        </Button>
      </div>

      {incidents.length === 0 ? (
        <EmptyState title="No incidents recorded" description="The breach register is empty." />
      ) : (
        <Table density="compact" className="[&_td]:align-top [&_th]:align-bottom">
          <THead>
            <Tr>
              <Th>Reference</Th>
              <Th>Incident</Th>
              <Th>Discovered</Th>
              <Th>Whose system</Th>
              <Th>Status</Th>
              <Th>Obligations</Th>
            </Tr>
          </THead>
          <TBody>
            {incidents.map(inc => {
              const unmet = inc.notifications.filter(
                n => !n.sent_at && !n.not_applicable,
              );
              const overdue = unmet.filter(n => n.deadline.state === 'overdue');
              return (
                <Tr key={inc.id} clickable onClick={() => setSelected(inc)}>
                  <Td className="font-mono text-xs">{inc.reference}</Td>
                  <Td>
                    <div className="font-medium text-ink">{inc.title}</div>
                    <Badge variant={SEVERITY_BADGE[inc.severity] ?? 'neutral'}>{inc.severity}</Badge>
                    {inc.joint_process && (
                      <Badge variant="info" className="ml-1.5">
                        joint process
                      </Badge>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-muted">{formatDateTime(inc.discovered_at)}</Td>
                  <Td className="text-ink-muted">{inc.custody_party_label ?? inc.custody_party}</Td>
                  <Td>
                    <Badge variant={inc.status === 'closed' ? 'success' : 'warning'}>{inc.status}</Badge>
                  </Td>
                  <Td>
                    {overdue.length > 0 ? (
                      <span className="text-error-600 font-bold">{overdue.length} overdue</span>
                    ) : unmet.length > 0 ? (
                      <span className="text-amber-700 font-semibold">{unmet.length} pending</span>
                    ) : (
                      <span className="text-success-600">all met</span>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}

      <CreateIncidentModal
        open={creating}
        custodyParties={custodyParties}
        onClose={() => setCreating(false)}
        onCreated={async inc => {
          setCreating(false);
          await load();
          onChanged();
          setSelected(inc);
        }}
      />

      <IncidentDetailModal
        incident={selected}
        custodyParties={custodyParties}
        onClose={() => setSelected(null)}
        onChanged={async () => {
          await load();
          onChanged();
          if (selected) setSelected(await api.getIncident(selected.id));
        }}
      />
    </div>
  );
};

const CreateIncidentModal: React.FC<{
  open: boolean;
  custodyParties: Record<string, string>;
  onClose: () => void;
  onCreated: (incident: api.BreachIncident) => void;
}> = ({ open, custodyParties, onClose, onCreated }) => {
  const { showToast } = useToast();
  const [form, setForm] = useState({
    title: '',
    summary: '',
    severity: 'high',
    custody_party: 'undetermined',
    custody_rationale: '',
    controlling_system: '',
    joint_process: false,
    phi_involved: true,
    affected_subject_count: '',
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.title.trim()) {
      showToast('Give the incident a title.', 'warning');
      return;
    }
    setBusy(true);
    try {
      const incident = await api.createIncident({
        ...form,
        affected_subject_count: form.affected_subject_count
          ? Number(form.affected_subject_count)
          : null,
      });
      showToast(`${incident.reference} opened. The reporting clocks are running.`, 'success');
      onCreated(incident);
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Could not open the incident.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Report a data breach" size="lg">
      <div className="flex flex-col gap-4">
        <Alert variant="warning">
          The deadlines are computed from now, because the law counts from the moment you became
          aware. Report first with what you know; the detail can be filled in as you learn it.
        </Alert>
        <Field label="What happened">
          <Input
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. Supervisor account signed in from an unrecognised address"
          />
        </Field>
        <Field label="Description">
          <textarea
            className="w-full rounded-lg border border-border bg-surface p-3 text-sm"
            rows={3}
            value={form.summary}
            onChange={e => setForm({ ...form, summary: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Severity">
            <Select value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </Select>
          </Field>
          <Field label="People affected (if known)">
            <Input
              type="number"
              min={0}
              value={form.affected_subject_count}
              onChange={e => setForm({ ...form, affected_subject_count: e.target.value })}
            />
          </Field>
        </div>
        <Field label="In whose system did it occur?">
          <Select
            value={form.custody_party}
            onChange={e => setForm({ ...form, custody_party: e.target.value })}
          >
            {Object.entries(custodyParties).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-xs text-ink-muted">
            The MOU puts responsibility with the party in whose custody, control or technical system
            the breach occurred.
          </p>
        </Field>
        <Field label="Which component">
          <Input
            value={form.controlling_system}
            onChange={e => setForm({ ...form, controlling_system: e.target.value })}
            placeholder="e.g. the NurtureHUB application server, a shared export file, a state portal"
          />
        </Field>
        <Field label="Why you reached that conclusion">
          <textarea
            className="w-full rounded-lg border border-border bg-surface p-3 text-sm"
            rows={2}
            value={form.custody_rationale}
            onChange={e => setForm({ ...form, custody_rationale: e.target.value })}
          />
        </Field>
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.joint_process}
            onChange={e => setForm({ ...form, joint_process: e.target.checked })}
          />
          <span>
            <strong>Shared system or joint process.</strong> Ticking this adds a counterparty
            notification so the mutual determination on fault and control actually starts.
          </span>
        </label>
        <label className="flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={form.phi_involved}
            onChange={e => setForm({ ...form, phi_involved: e.target.checked })}
          />
          <span>Personal data of mothers or children was involved</span>
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void submit()}>
            Open incident
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const IncidentDetailModal: React.FC<{
  incident: api.BreachIncident | null;
  custodyParties: Record<string, string>;
  onClose: () => void;
  onChanged: () => void;
}> = ({ incident, custodyParties, onClose, onChanged }) => {
  const { showToast } = useToast();
  const [draft, setDraft] = useState<{ authority: string; text: string; label: string } | null>(null);
  const [evidence, setEvidence] = useState<api.CustodyEvidence | null>(null);
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState('');

  useEffect(() => {
    setDraft(null);
    setEvidence(null);
    setReference('');
  }, [incident?.id]);

  if (!incident) return null;

  const showDraft = async (authority: string, label: string) => {
    try {
      const res = await api.notificationDraft(incident.id, authority);
      setDraft({ authority, text: res.draft, label });
    } catch {
      showToast('Could not build the draft.', 'error');
    }
  };

  const recordSent = async (authority: string) => {
    setBusy(true);
    try {
      await api.markNotificationSent(incident.id, authority, {
        channel: 'email',
        reference_number: reference.trim() || undefined,
        content: draft?.authority === authority ? draft.text : undefined,
      });
      showToast('Recorded as notified.', 'success');
      setDraft(null);
      setReference('');
      onChanged();
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Could not record it.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const loadEvidence = async () => {
    try {
      setEvidence(await api.incidentEvidence(incident.id));
    } catch {
      showToast('Could not assemble the evidence.', 'error');
    }
  };

  const contain = async () => {
    if (!window.confirm('End every live session in the system? Everyone, including you, will be signed out.')) return;
    setBusy(true);
    try {
      const res = await api.revokeSessions({ scope: 'all', reason: 'breach', incident_id: incident.id });
      showToast(`${res.sessions_ended} session(s) ended. You will need to sign in again.`, 'success');
      onChanged();
    } catch {
      showToast('Could not end the sessions.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`${incident.reference} · ${incident.title}`} size="xl">
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-ink-muted">Discovered </span>
            <span className="text-ink font-medium">{formatDateTime(incident.discovered_at)}</span>
          </div>
          <div>
            <span className="text-ink-muted">Status </span>
            <Badge variant={incident.status === 'closed' ? 'success' : 'warning'}>{incident.status}</Badge>
          </div>
          <div>
            <span className="text-ink-muted">Custody </span>
            <span className="text-ink font-medium">
              {custodyParties[incident.custody_party] ?? incident.custody_party}
            </span>
          </div>
          <div>
            <span className="text-ink-muted">People affected </span>
            <span className="text-ink font-medium">{incident.affected_subject_count ?? 'under assessment'}</span>
          </div>
        </div>

        {incident.summary && <p className="text-sm text-ink">{incident.summary}</p>}

        <div>
          <h4 className="font-display font-bold text-base text-ink mb-2">Notification obligations</h4>
          <Table density="compact" className="[&_td]:align-top [&_th]:align-bottom">
            <THead>
              <Tr>
                <Th>Authority</Th>
                <Th>Due</Th>
                <Th>Status</Th>
                <Th />
              </Tr>
            </THead>
            <TBody>
              {incident.notifications.map(n => (
                <Tr key={n.id}>
                  <Td>
                    <div className="font-medium text-ink">{n.authority_label}</div>
                    <div className="text-[11px] text-ink-muted">{n.legal_basis}</div>
                  </Td>
                  <Td className="whitespace-nowrap">{formatDateTime(n.due_at)}</Td>
                  <Td className={cn('whitespace-nowrap', DEADLINE_TONE[n.deadline.state])}>
                    {n.not_applicable
                      ? 'not applicable'
                      : n.sent_at
                        ? `sent ${formatDateTime(n.sent_at)}`
                        : `${formatRemaining(n.deadline.seconds_remaining)} left`}
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    {!n.sent_at && !n.not_applicable && (
                      <Button variant="ghost" onClick={() => void showDraft(n.authority, n.authority_label)}>
                        Draft
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>

        {draft && (
          <Card className="p-4">
            <h4 className="font-semibold text-ink mb-2">Draft — {draft.label}</h4>
            <p className="text-[13px] text-ink-muted mb-2">
              A draft, not a filing. Read it, send it yourself, then record it below with the
              acknowledgement number the authority gives you.
            </p>
            <textarea
              className="w-full rounded-lg border border-border bg-surface p-3 text-xs font-mono"
              rows={16}
              value={draft.text}
              onChange={e => setDraft({ ...draft, text: e.target.value })}
            />
            <div className="flex flex-wrap items-end gap-3 mt-3">
              <Field label="Acknowledgement / reference number" className="flex-1 min-w-56">
                <Input value={reference} onChange={e => setReference(e.target.value)} />
              </Field>
              <Button
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard.writeText(draft.text);
                  showToast('Draft copied.', 'success');
                }}
              >
                Copy
              </Button>
              <Button loading={busy} onClick={() => void recordSent(draft.authority)}>
                Record as sent
              </Button>
            </div>
          </Card>
        )}

        <div>
          <div className="flex items-center justify-between gap-3 mb-2">
            <h4 className="font-display font-bold text-base text-ink">
              Custody and fault evidence
            </h4>
            <Button variant="ghost" onClick={() => void loadEvidence()}>
              <Fingerprint className="size-4" /> Assemble from the audit trail
            </Button>
          </div>
          {evidence && (
            <Card className="p-4">
              <p className="text-[13px] text-ink-muted mb-3">{evidence.note}</p>
              {evidence.audit_trail_intact ? (
                <Alert variant="success" className="mb-3">
                  The audit trail for this window verifies intact, so this evidence can be relied on.
                </Alert>
              ) : (
                <Alert variant="error" className="mb-3">
                  The audit trail does not verify — the evidence below may be incomplete.
                </Alert>
              )}
              <Table density="compact" className="[&_td]:align-top [&_th]:align-bottom">
                <THead>
                  <Tr>
                    <Th>Account</Th>
                    <Th>Events</Th>
                    <Th>Records touched</Th>
                    <Th>Addresses</Th>
                  </Tr>
                </THead>
                <TBody>
                  {evidence.actors.map(a => (
                    <Tr key={a.actor}>
                      <Td>
                        {a.actor} <span className="text-xs text-ink-muted">({a.actor_type})</span>
                      </Td>
                      <Td>{a.events}</Td>
                      <Td>{a.records}</Td>
                      <Td>{a.distinct_addresses}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              {evidence.exports.length > 0 && (
                <>
                  <h5 className="font-semibold text-ink mt-4 mb-1.5 text-sm">
                    Exports in this window — data that left the platform's custody
                  </h5>
                  <ul className="text-sm text-ink-muted list-disc pl-5">
                    {evidence.exports.map(e => (
                      <li key={e.audit_event_id}>
                        {formatDateTime(e.at)} — {e.actor} exported {e.records} record(s) from {e.path}{' '}
                        ({e.source_ip})
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          )}
        </div>

        <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
          <Button variant="danger" loading={busy} onClick={() => void contain()}>
            <UserX className="size-4" /> End every session (containment)
          </Button>
          {incident.status !== 'closed' && (
            <Button
              variant="ghost"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.updateIncident(incident.id, { status: 'closed' });
                  showToast('Incident closed.', 'success');
                  onChanged();
                } catch (err: any) {
                  showToast(err.response?.data?.detail || 'Could not close it.', 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <CheckCircle2 className="size-4" /> Close incident
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Access control
// ═══════════════════════════════════════════════════════════════════════════

const AccessTab: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const { showToast } = useToast();
  const [sessions, setSessions] = useState<api.LiveSession[]>([]);
  const [lockouts, setLockouts] = useState<api.Lockout[]>([]);
  const [mfa, setMfa] = useState<api.MfaStatus | null>(null);
  const [admins, setAdmins] = useState<Awaited<ReturnType<typeof api.mfaAdministrators>> | null>(null);
  const [enrolment, setEnrolment] = useState<Awaited<ReturnType<typeof api.mfaEnroll>> | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, l, m, a] = await Promise.all([
        api.listSessions(),
        api.listLockouts(),
        api.mfaStatus(),
        api.mfaAdministrators(),
      ]);
      setSessions(s.sessions);
      setLockouts(l.lockouts);
      setMfa(m);
      setAdmins(a);
    } catch {
      showToast('Could not load access control.', 'error');
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEnrolment = async () => {
    setBusy(true);
    try {
      setEnrolment(await api.mfaEnroll());
      setRecovery(null);
      setCode('');
    } catch {
      showToast('Could not start enrolment.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirmEnrolment = async () => {
    setBusy(true);
    try {
      const res = await api.mfaConfirm(code);
      setRecovery(res.recovery_codes);
      setEnrolment(null);
      showToast('Second factor is now active on your account.', 'success');
      await load();
      onChanged();
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'That code was not accepted.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5">
        <h3 className="font-display font-bold text-lg text-ink flex items-center gap-2 mb-1">
          <KeyRound className="size-5" /> Your second factor
        </h3>
        <p className="text-sm text-ink-muted mb-4">
          An administrator token reads every mother and child in the programme. A password alone is
          the wrong protection for that.
        </p>

        {mfa?.enrolled ? (
          <Alert variant="success">
            Active since {formatDateTime(mfa.confirmed_at)}. {mfa.recovery_codes_remaining} recovery
            code(s) remaining.
          </Alert>
        ) : enrolment ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink">
              Add this to your authenticator app — scan is unavailable here, so enter the key by hand
              or open the link on the phone itself.
            </p>
            <div className="rounded-lg bg-surface-sunken p-4">
              <div className="text-xs text-ink-muted mb-1">Setup key</div>
              <code className="text-base font-mono tracking-wider break-all">{enrolment.secret_formatted}</code>
              <div className="mt-2">
                <a href={enrolment.otpauth_uri} className="text-sm text-primary-ink hover:underline">
                  Open in authenticator app
                </a>
              </div>
            </div>
            <Field label="Enter the 6-digit code it shows">
              <Input
                value={code}
                onChange={e => setCode(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
              />
            </Field>
            <div className="flex gap-2">
              <Button loading={busy} onClick={() => void confirmEnrolment()}>
                Confirm
              </Button>
              <Button variant="ghost" onClick={() => setEnrolment(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={() => void startEnrolment()} loading={busy}>
            <KeyRound className="size-4" /> Set up an authenticator app
          </Button>
        )}

        {recovery && (
          <Alert variant="warning" className="mt-4">
            <div className="font-semibold mb-2">
              Save these recovery codes now — they are shown once and each works once.
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 font-mono text-sm">
              {recovery.map(c => (
                <code key={c} className="rounded bg-surface px-2 py-1">
                  {c}
                </code>
              ))}
            </div>
          </Alert>
        )}
      </Card>

      {admins && (
        <Card className="p-5">
          <h3 className="font-display font-bold text-lg text-ink mb-1">Administrator accounts</h3>
          <p className="text-sm text-ink-muted mb-4">
            {admins.required
              ? 'A second factor is required for administrators on this deployment.'
              : 'A second factor is not yet required. Enrol everyone first, then turn on MFA_REQUIRED_FOR_ADMINS.'}
          </p>
          <Table density="compact" className="[&_td]:align-top [&_th]:align-bottom">
            <THead>
              <Tr>
                <Th>Account</Th>
                <Th>Second factor</Th>
                <Th>Last used</Th>
                <Th />
              </Tr>
            </THead>
            <TBody>
              {admins.administrators.map(a => (
                <Tr key={a.email}>
                  <Td>
                    <div className="font-medium text-ink">{a.full_name || a.email}</div>
                    <div className="text-xs text-ink-muted">{a.email}</div>
                  </Td>
                  <Td>
                    {a.enrolled ? (
                      <Badge variant="success">enrolled</Badge>
                    ) : (
                      <Badge variant="warning">password only</Badge>
                    )}
                  </Td>
                  <Td className="text-ink-muted">{formatDateTime(a.last_used_at)}</Td>
                  <Td className="text-right align-middle">
                    {a.enrolled && (
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          if (!window.confirm(`Remove the second factor from ${a.email}? Only do this for a lost device.`)) return;
                          try {
                            await api.mfaDisable(a.email);
                            showToast('Removed.', 'success');
                            await load();
                          } catch (err: any) {
                            showToast(err.response?.data?.detail || 'Could not remove it.', 'error');
                          }
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <Card className="p-5">
        <h3 className="font-display font-bold text-lg text-ink mb-1">Live sessions</h3>
        <p className="text-sm text-ink-muted mb-4">
          Ending a session takes effect within seconds, on every server. This is the first
          containment step in almost every real incident.
        </p>
        {sessions.length === 0 ? (
          <EmptyState title="Nobody is signed in" description="" />
        ) : (
          <Table density="compact" className="[&_td]:align-top [&_th]:align-bottom">
            <THead>
              <Tr>
                <Th>Account</Th>
                <Th>Signed in</Th>
                <Th>Last seen</Th>
                <Th>From</Th>
                <Th />
              </Tr>
            </THead>
            <TBody>
              {sessions.map(s => (
                <Tr key={s.jti}>
                  <Td>
                    <div className="font-medium text-ink">{s.principal}</div>
                    {s.is_admin && <Badge variant="coral">administrator</Badge>}
                    {s.is_admin && !s.mfa_satisfied && (
                      <Badge variant="warning" className="ml-1.5">
                        password only
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-ink-muted whitespace-nowrap">{formatDateTime(s.issued_at)}</Td>
                  <Td className="text-ink-muted whitespace-nowrap">{formatDateTime(s.last_seen_at)}</Td>
                  <Td className="text-ink-muted">{s.source_ip ?? '—'}</Td>
                  <Td className="text-right align-middle">
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await api.endSession(s.jti);
                          showToast('Session ended.', 'success');
                          await load();
                          onChanged();
                        } catch {
                          showToast('Could not end that session.', 'error');
                        }
                      }}
                    >
                      End
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="font-display font-bold text-lg text-ink mb-1">Locked accounts</h3>
        <p className="text-sm text-ink-muted mb-4">
          Locked after repeated failed sign-ins. Lockouts clear themselves; unlock only when you have
          spoken to the person.
        </p>
        {lockouts.length === 0 ? (
          <p className="text-sm text-ink-muted">No accounts are locked.</p>
        ) : (
          <Table density="compact" className="[&_td]:align-top [&_th]:align-bottom">
            <THead>
              <Tr>
                <Th>Account</Th>
                <Th>Failures</Th>
                <Th>Unlocks in</Th>
                <Th />
              </Tr>
            </THead>
            <TBody>
              {lockouts.map(l => (
                <Tr key={l.id}>
                  <Td className="font-medium text-ink">{l.principal}</Td>
                  <Td>{l.failure_count}</Td>
                  <Td>{formatRemaining(l.seconds_remaining)}</Td>
                  <Td className="text-right align-middle">
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await api.clearLockout(l.principal);
                          showToast('Unlocked.', 'success');
                          await load();
                          onChanged();
                        } catch {
                          showToast('Could not unlock.', 'error');
                        }
                      }}
                    >
                      <Unlock className="size-4" /> Unlock
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Governance
// ═══════════════════════════════════════════════════════════════════════════

const GovernanceTab: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const { showToast } = useToast();
  const [requests, setRequests] = useState<api.DataSubjectRequest[]>([]);
  const [retention, setRetention] = useState<Awaited<ReturnType<typeof api.listRetention>> | null>(null);
  const [ropa, setRopa] = useState<api.ProcessingActivity[]>([]);
  const [consent, setConsent] = useState<api.ConsentSummary | null>(null);
  const [erasures, setErasures] = useState<api.ErasureRecord[]>([]);
  const [dryRun, setDryRun] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<api.DataSubjectRequest | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, ret, rp, c, e] = await Promise.all([
        api.listRequests(),
        api.listRetention(),
        api.listRopa(),
        api.consentSummary(),
        api.listErasures(),
      ]);
      setRequests(r.requests);
      setRetention(ret);
      setRopa(rp.activities);
      setConsent(c);
      setErasures(e.erasures);
    } catch {
      showToast('Could not load the governance registers.', 'error');
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5">
        <h3 className="font-display font-bold text-lg text-ink mb-1">
          Requests from mothers and guardians
        </h3>
        <p className="text-sm text-ink-muted mb-4">
          Access, correction, erasure and grievances under the DPDP Act. Verify who someone is before
          you disclose or delete anything — handing a record to the wrong person is itself the breach
          this is meant to prevent.
        </p>
        {requests.length === 0 ? (
          <p className="text-sm text-ink-muted">No requests have been received.</p>
        ) : (
          <Table density="compact" className="[&_td]:align-top [&_th]:align-bottom">
            <THead>
              <Tr>
                <Th>Reference</Th>
                <Th>Type</Th>
                <Th>From</Th>
                <Th>Due</Th>
                <Th>Status</Th>
                <Th />
              </Tr>
            </THead>
            <TBody>
              {requests.map(r => (
                <Tr key={r.id}>
                  <Td className="font-mono text-xs">{r.reference}</Td>
                  <Td>{r.request_type}</Td>
                  <Td>
                    <div className="text-ink">{r.requested_by ?? '—'}</div>
                    <div className="text-xs text-ink-muted">{r.subject_identifier}</div>
                  </Td>
                  <Td className={r.overdue ? 'text-error-600 font-bold' : 'text-ink-muted'}>
                    {r.overdue ? 'overdue' : `${r.days_remaining ?? '—'} days`}
                  </Td>
                  <Td>
                    <Badge variant={r.closed_at ? 'success' : r.identity_verified ? 'info' : 'warning'}>
                      {r.status}
                    </Badge>
                  </Td>
                  <Td className="text-right align-middle">
                    <Button variant="ghost" onClick={() => setEditing(r)}>
                      Handle
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <RequestModal
        request={editing}
        onClose={() => setEditing(null)}
        onChanged={async () => {
          await load();
          onChanged();
        }}
      />

      {consent && (
        <Card className="p-5">
          <h3 className="font-display font-bold text-lg text-ink mb-1">Consent register</h3>
          <p className="text-sm text-ink-muted mb-4">
            Notice version <code>{consent.notice_version}</code> · {consent.subjects.mothers} mothers
            and {consent.subjects.children} children registered. A child's consent is given by her
            guardian, recorded with how it was verified.
          </p>
          <Table density="compact" className="[&_td]:align-top [&_th]:align-bottom">
            <THead>
              <Tr>
                <Th>Data principal</Th>
                <Th>Purpose</Th>
                <Th>Consent live</Th>
                <Th>Withdrawn</Th>
              </Tr>
            </THead>
            <TBody>
              {consent.records.map(r => (
                <Tr key={`${r.subject_type}-${r.purpose}`}>
                  <Td>{r.subject_type}</Td>
                  <Td>
                    {consent.purposes[r.purpose]?.label ?? r.purpose}
                    {consent.purposes[r.purpose]?.essential && (
                      <Badge variant="neutral" className="ml-1.5">
                        essential
                      </Badge>
                    )}
                  </Td>
                  <Td>{r.granted}</Td>
                  <Td className={r.withdrawn ? 'text-amber-700 font-semibold' : 'text-ink-muted'}>
                    {r.withdrawn}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {retention && (
        <Card className="p-5">
          <h3 className="font-display font-bold text-lg text-ink mb-1">Retention schedule</h3>
          <p className="text-sm text-ink-muted mb-4">
            Logs must be kept at least {retention.cert_in_log_floor_days} days (CERT-In). Patient
            records are never deleted automatically — they are flagged for a human decision.
          </p>
          <Table density="compact" className="[&_td]:align-top [&_th]:align-bottom">
            <THead>
              <Tr>
                <Th>Data</Th>
                <Th>Kept for</Th>
                <Th>Then</Th>
                <Th>Last run</Th>
              </Tr>
            </THead>
            <TBody>
              {retention.policies.map(p => (
                <Tr key={p.key}>
                  <Td>
                    <div className="font-medium text-ink">{p.label}</div>
                    <div className="text-xs text-ink-muted">{p.description}</div>
                  </Td>
                  <Td className="whitespace-nowrap">{p.retention_days} days</Td>
                  <Td>
                    <Badge variant={p.action === 'delete' ? 'warning' : 'neutral'}>{p.action}</Badge>
                  </Td>
                  <Td className="text-ink-muted whitespace-nowrap">
                    {p.last_run_at ? `${formatDateTime(p.last_run_at)} (${p.last_run_rows ?? 0})` : 'never'}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <div className="flex flex-wrap gap-2 mt-4">
            <Button
              variant="ghost"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const res = await api.runRetention(true);
                  setDryRun(res.policies);
                  showToast('Dry run complete — nothing was deleted.', 'success');
                } catch {
                  showToast('The dry run failed.', 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <RefreshCw className="size-4" /> Dry run
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                if (!window.confirm('Apply the retention schedule for real? Expired operational logs will be deleted.')) return;
                setBusy(true);
                try {
                  const res = await api.runRetention(false);
                  showToast(`${res.total_deleted} row(s) deleted.`, 'success');
                  setDryRun(res.policies);
                  await load();
                } catch {
                  showToast('The retention run failed.', 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Trash2 className="size-4" /> Apply schedule
            </Button>
          </div>
          {dryRun && (
            <pre className="mt-3 rounded-lg bg-surface-sunken p-3 text-xs overflow-x-auto">
              {JSON.stringify(dryRun, null, 2)}
            </pre>
          )}
        </Card>
      )}

      <Card className="p-5">
        <h3 className="font-display font-bold text-lg text-ink mb-1">
          What data this platform holds
        </h3>
        <p className="text-sm text-ink-muted mb-4">
          The record of processing activities — the fastest honest answer to "what data of our
          citizens will you hold, why, where, and for how long".
        </p>
        <div className="flex flex-col gap-3">
          {ropa.map(a => (
            <details key={a.key} className="rounded-xl border border-border p-4">
              <summary className="cursor-pointer font-semibold text-ink">
                {a.name}
                {a.special_category && (
                  <Badge variant="coral" className="ml-2">
                    health data
                  </Badge>
                )}
                {a.cross_border && (
                  <Badge variant="info" className="ml-1.5">
                    stored outside India
                  </Badge>
                )}
              </summary>
              <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-ink-muted">Purpose</dt>
                <dd className="text-ink">{a.purpose}</dd>
                <dt className="text-ink-muted">Lawful basis</dt>
                <dd className="text-ink">{a.lawful_basis}</dd>
                <dt className="text-ink-muted">Data held</dt>
                <dd className="text-ink">{a.data_categories.join(', ')}</dd>
                <dt className="text-ink-muted">About whom</dt>
                <dd className="text-ink">{a.subject_categories.join(', ')}</dd>
                <dt className="text-ink-muted">Shared with</dt>
                <dd className="text-ink">{a.recipients.join(', ') || 'nobody outside the programme'}</dd>
                <dt className="text-ink-muted">Where</dt>
                <dd className="text-ink">{a.storage_location ?? '—'}</dd>
                <dt className="text-ink-muted">Kept for</dt>
                <dd className="text-ink">
                  {a.retention_months ? `${a.retention_months} months` : '—'}
                  {a.retention_rationale ? ` — ${a.retention_rationale}` : ''}
                </dd>
                <dt className="text-ink-muted">Protected by</dt>
                <dd className="text-ink">{a.security_measures.join('; ')}</dd>
              </dl>
            </details>
          ))}
        </div>
      </Card>

      {erasures.length > 0 && (
        <Card className="p-5">
          <h3 className="font-display font-bold text-lg text-ink mb-1">Erasure register</h3>
          <p className="text-sm text-ink-muted mb-4">
            Proof that data was destroyed, kept after the data itself is gone — identifiers, counts
            and a digest, never a copy of what was removed.
          </p>
          <Table density="compact" className="[&_td]:align-top [&_th]:align-bottom">
            <THead>
              <Tr>
                <Th>When</Th>
                <Th>Record</Th>
                <Th>Why</Th>
                <Th>Rows</Th>
                <Th>By</Th>
              </Tr>
            </THead>
            <TBody>
              {erasures.map(e => (
                <Tr key={e.id}>
                  <Td className="whitespace-nowrap text-ink-muted">{formatDateTime(e.performed_at)}</Td>
                  <Td className="font-mono text-xs">{e.subject_uid ?? '—'}</Td>
                  <Td>{e.trigger}</Td>
                  <Td>{e.rows_deleted}</Td>
                  <Td className="text-ink-muted">{e.performed_by ?? '—'}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
};

const RequestModal: React.FC<{
  request: api.DataSubjectRequest | null;
  onClose: () => void;
  onChanged: () => void;
}> = ({ request, onClose, onChanged }) => {
  const { showToast } = useToast();
  const [subjectId, setSubjectId] = useState('');
  const [method, setMethod] = useState('in_person');
  const [confirmRef, setConfirmRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [bundle, setBundle] = useState<Record<string, unknown> | null>(null);

  // Reset the form when a DIFFERENT request is opened. Keyed on the id alone on
  // purpose: including request.subject_id would wipe what the operator is
  // typing the moment a save round-trips and the prop updates.
  useEffect(
    () => {
      setSubjectId(request?.subject_id ? String(request.subject_id) : '');
      setConfirmRef('');
      setBundle(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [request?.id],
  );

  if (!request) return null;

  const patch = async (body: Record<string, unknown>, message: string) => {
    setBusy(true);
    try {
      await api.updateRequest(request.id, body);
      showToast(message, 'success');
      onChanged();
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Could not update the request.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`${request.reference} · ${request.request_type}`} size="lg">
      <div className="flex flex-col gap-4 text-sm">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
          <dt className="text-ink-muted">From</dt>
          <dd className="text-ink">{request.requested_by ?? '—'}</dd>
          <dt className="text-ink-muted">About</dt>
          <dd className="text-ink">{request.subject_identifier ?? '—'}</dd>
          <dt className="text-ink-muted">Received</dt>
          <dd className="text-ink">{formatDateTime(request.created_at)}</dd>
          <dt className="text-ink-muted">Due</dt>
          <dd className={request.overdue ? 'text-error-600 font-bold' : 'text-ink'}>
            {formatDateTime(request.due_at)}
          </dd>
        </dl>
        {request.details && (
          <p className="rounded-lg bg-surface-sunken p-3 text-ink">{request.details}</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Link to the mother's record (id)">
            <Input value={subjectId} onChange={e => setSubjectId(e.target.value)} placeholder="e.g. 42" />
          </Field>
          <Field label="How you verified who they are">
            <Select value={method} onChange={e => setMethod(e.target.value)}>
              <option value="in_person">In person, with the health worker</option>
              <option value="otp">One-time code to the registered number</option>
              <option value="signature">Signed request</option>
              <option value="thumbprint">Thumbprint</option>
            </Select>
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            loading={busy}
            onClick={() =>
              void patch(
                {
                  subject_id: subjectId ? Number(subjectId) : null,
                  identity_verified: true,
                  verification_method: method,
                  status: 'in_progress',
                },
                'Identity recorded as verified.',
              )
            }
          >
            <CheckCircle2 className="size-4" /> Identity verified
          </Button>

          {request.request_type === 'access' && (
            <Button
              variant="ghost"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setBundle(await api.accessBundle(request.id));
                  showToast('Assembled. Give this to the requester.', 'success');
                } catch (err: any) {
                  showToast(err.response?.data?.detail || 'Could not assemble it.', 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Download className="size-4" /> Assemble their data
            </Button>
          )}

          <Button
            variant="ghost"
            loading={busy}
            onClick={() => void patch({ status: 'fulfilled' }, 'Marked as fulfilled.')}
          >
            Mark fulfilled
          </Button>
        </div>

        {request.request_type === 'erasure' && (
          <Card className="p-4 border-l-4 border-l-error-500">
            <h4 className="font-semibold text-ink mb-1">Erase this record</h4>
            <p className="text-ink-muted mb-3">
              Irreversible. Deleting the mother deletes her children and their growth history with
              her. Type <code>{request.reference}</code> to confirm.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Confirm reference" className="flex-1 min-w-48">
                <Input value={confirmRef} onChange={e => setConfirmRef(e.target.value)} />
              </Field>
              <Button
                variant="danger"
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.fulfilErasure(request.id, {
                      method: 'hard_delete',
                      confirm_reference: confirmRef,
                    });
                    showToast('Erased, and recorded in the erasure register.', 'success');
                    onChanged();
                    onClose();
                  } catch (err: any) {
                    showToast(err.response?.data?.detail || 'Could not erase.', 'error');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Trash2 className="size-4" /> Erase permanently
              </Button>
            </div>
          </Card>
        )}

        {bundle && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-ink-muted">Their data</span>
              <Button
                variant="ghost"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${request.reference}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download className="size-4" /> Download
              </Button>
            </div>
            <pre className="rounded-lg bg-surface-sunken p-3 text-xs overflow-x-auto max-h-96">
              {JSON.stringify(bundle, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default AdminDataProtectionPage;
