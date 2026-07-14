import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Search, Users, AlertTriangle, Shield, Clock,
  Eye, Flag, MessageSquare, Send, Activity,
  Wifi, WifiOff, Radio, BarChart3, Target,
  Zap, AlertCircle, CheckCircle, Pause, SkipForward,
  FileText, TrendingUp, MonitorSmartphone, Download, ArrowUp, ArrowDown,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useAdminMonitorSocket } from '../../hooks/useAdminMonitorSocket';
import type { CandidateState } from '../../hooks/useAdminMonitorSocket';
import client from '../../api/client';
import {
  Button, Card, Badge, Modal, Table, THead, TBody, Tr, Th, Td,
  StatCard, Input, Select, Chip, EmptyState, PageHeader, Spinner, Avatar,
  inputClasses,
} from '../../components/ui';
import type { BadgeVariant } from '../../components/ui';
import { cn } from '../../utils/cn';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

type SortField = 'risk_score' | 'remaining_seconds' | 'questions_attempted' | 'accuracy_pct' | 'tab_switch_count' | 'status';
type StatusFilter = '' | 'active' | 'idle' | 'disconnected' | 'submitted' | 'auto_submitted' | 'not_started';

// ─────────────────────────────────────────
// Helper Components (restyled with Tailwind + components/ui)
// ─────────────────────────────────────────

const StatusBadge: React.FC<{ status: string; t: TFunction }> = ({ status, t }) => {
  const config: Record<string, { variant: BadgeVariant; icon: React.ReactNode }> = {
    active: { variant: 'success', icon: <Activity className="size-3" /> },
    idle: { variant: 'warning', icon: <Pause className="size-3" /> },
    started: { variant: 'success', icon: <Activity className="size-3" /> },
    not_started: { variant: 'neutral', icon: <Clock className="size-3" /> },
    submitted: { variant: 'info', icon: <CheckCircle className="size-3" /> },
    auto_submitted: { variant: 'coral', icon: <SkipForward className="size-3" /> },
    disconnected: { variant: 'error', icon: <WifiOff className="size-3" /> },
  };
  const key = config[status] ? status : 'active';
  const c = config[key];
  return (
    <Badge variant={c.variant} className="inline-flex items-center gap-1 whitespace-nowrap">
      {c.icon} {t(`status.${key}`)}
    </Badge>
  );
};

const RiskIndicator: React.FC<{ score: number; t: TFunction }> = ({ score, t }) => {
  // low <20 (green), medium 20–49 (amber), high >=50 (red)
  const fill = score >= 50 ? 'bg-error-500' : score >= 20 ? 'bg-amber-500' : 'bg-success-500';
  const text = score >= 50 ? 'text-error-500' : score >= 20 ? 'text-amber-600' : 'text-success-600';
  return (
    <div className="flex items-center gap-2" title={t('riskScoreTitle', { score })}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className={cn('h-full rounded-full transition-[width] duration-500', fill)}
          style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
        />
      </div>
      <span className={cn('text-xs font-bold tabular-nums', text)}>{score}</span>
    </div>
  );
};

const ProgressBar: React.FC<{ current: number; total: number }> = ({ current, total }) => {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-xs font-semibold text-ink-muted tabular-nums">{current}/{total}</span>
    </div>
  );
};

const formatTime = (secs: number) => {
  if (secs <= 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

// ─────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────

const AdminLiveMonitorPage: React.FC = () => {
  const { t } = useTranslation('adminLiveMonitor');
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const numericTestId = parseInt(testId || '0');

  // ── WebSocket connection ──
  const {
    candidateList,
    testInfo,
    isConnected,
    isLoading,
    error,
    sendAction,
  } = useAdminMonitorSocket(numericTestId);

  // ── Local UI state ──
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('risk_score');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateState | null>(null);
  const [detailData, setDetailData] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showActionModal, setShowActionModal] = useState<{ type: string; candidate: CandidateState } | null>(null);
  const [actionNotes, setActionNotes] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Stats from REST (polled every 10s for aggregate metrics)
  const [stats, setStats] = useState<any>(null);
  const statsIntervalRef = useRef<any>(null);

  useEffect(() => {
    const fetchStats = () => {
      client.get(`/api/admin/tests/${numericTestId}/live/stats`)
        .then(res => setStats(res.data))
        .catch(() => {});
    };
    fetchStats();
    statsIntervalRef.current = setInterval(fetchStats, 10000);
    return () => clearInterval(statsIntervalRef.current);
  }, [numericTestId]);

  // ── Keep selected candidate updated from WS feed ──
  useEffect(() => {
    if (selectedCandidate) {
      const updated = candidateList.find(c => c.session_id === selectedCandidate.session_id);
      if (updated) {
        setSelectedCandidate(updated);
      }
    }
  }, [candidateList, selectedCandidate?.session_id]);

  // ── Filtered and sorted candidates ──
  const filteredCandidates = useMemo(() => {
    let list = [...candidateList];

    // Status filter
    if (statusFilter) {
      list = list.filter(c => c.status === statusFilter);
    }

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c =>
        (c.user_name || '').toLowerCase().includes(q) ||
        (c.user_email || '').toLowerCase().includes(q)
      );
    }

    // Sort
    list.sort((a, b) => {
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];
      if (aVal == null) aVal = 0;
      if (bVal == null) bVal = 0;
      if (typeof aVal === 'string') {
        return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return list;
  }, [candidateList, searchQuery, sortField, sortOrder, statusFilter]);

  // ── Candidate detail ──
  const openCandidateDetail = useCallback((candidate: CandidateState) => {
    setSelectedCandidate(candidate);
    setDetailLoading(true);
    client.get(`/api/admin/tests/${numericTestId}/live/candidate/${candidate.session_id}`)
      .then(res => { setDetailData(res.data); setDetailLoading(false); })
      .catch(() => setDetailLoading(false));
  }, [numericTestId]);

  const closeDetail = useCallback(() => {
    setSelectedCandidate(null);
    setDetailData(null);
  }, []);

  // ── Admin actions ──
  const handleAction = useCallback((type: string, candidate: CandidateState) => {
    if (type === 'FLAG') {
      sendAction({ action: 'FLAG', session_id: candidate.session_id, notes: t('actions.flaggedByAdmin') });
    } else if (type === 'FORCE_SUBMIT') {
      setShowActionModal({ type, candidate });
    } else if (type === 'SEND_WARNING') {
      setShowActionModal({ type, candidate });
    } else if (type === 'ADD_NOTE') {
      setShowActionModal({ type, candidate });
    } else if (type === 'UNFLAG') {
      sendAction({ action: 'UNFLAG', session_id: candidate.session_id });
    }
  }, [sendAction, t]);

  const confirmAction = useCallback(() => {
    if (!showActionModal) return;
    const { type, candidate } = showActionModal;
    sendAction({
      action: type,
      session_id: candidate.session_id,
      notes: actionNotes,
      message: actionNotes,
    });
    setShowActionModal(null);
    setActionNotes('');
  }, [showActionModal, actionNotes, sendAction]);

  // ── Excel export (full performance + anti-cheat report) ──
  const handleExport = useCallback(async () => {
    try {
      const res = await client.get(`/api/admin/tests/${numericTestId}/live/export`);
      const rows: any[] = res.data.rows || [];
      const headers = [
        t('export.headers.candidateName'), t('export.headers.email'), t('export.headers.status'), t('export.headers.ipAddress'), t('export.headers.connectedAt'),
        t('export.headers.questionsAttempted'), t('export.headers.totalQuestions'), t('export.headers.correct'), t('export.headers.wrong'), t('export.headers.accuracyPct'),
        t('export.headers.timeSpent'), t('export.headers.avgTimeQuestion'), t('export.headers.fastestQ'), t('export.headers.slowestQ'),
        t('export.headers.tabSwitches'), t('export.headers.fullscreenExits'), t('export.headers.windowBlurs'), t('export.headers.copyPasteEvents'),
        t('export.headers.questionSwitches'), t('export.headers.idlePeriods'), t('export.headers.riskScore'), t('export.headers.flagged'), t('export.headers.flagReason'),
        t('export.headers.suspiciousFlags'), t('export.headers.finalScorePct'), t('export.headers.passed'), t('export.headers.submittedAt'),
      ];
      const dataRows = rows.map(r => [
        r.candidate_name, r.email, r.status, r.ip_address, r.connected_at,
        r.questions_attempted, r.total_questions, r.correct_answers, r.wrong_answers, r.accuracy_pct,
        r.time_spent_seconds, r.avg_time_per_question_ms, r.fastest_question_ms, r.slowest_question_ms,
        r.tab_switch_count, r.fullscreen_exit_count, r.window_blur_count, r.copy_paste_count,
        r.question_switch_count, r.idle_periods, r.risk_score, r.is_flagged ? t('export.yes') : t('export.no'), r.flag_reason,
        r.suspicious_flags, r.final_score_pct, r.is_passed === null ? '—' : r.is_passed ? t('export.yes') : t('export.no'), r.submitted_at,
      ]);
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
      XLSX.utils.book_append_sheet(wb, ws, t('export.sheet'));
      XLSX.writeFile(wb, `test_${numericTestId}_performance_report.xlsx`);
    } catch (e) {
      console.error('Failed to export report:', e);
    }
  }, [numericTestId, t]);

  // ─────────────────────────────────────────
  // Early states
  // ─────────────────────────────────────────

  // Brief connecting state only on the very first attempt (clears on snapshot,
  // socket close, or missing token — never hangs forever).
  if (isLoading && !error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="flex flex-col items-center gap-3 px-10 py-12 text-center">
          <div className="relative flex size-14 items-center justify-center">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/30" />
            <Radio className="relative size-8 text-primary" />
          </div>
          <h3 className="font-display text-lg font-bold text-ink">{t('loading.title')}</h3>
          <p className="text-sm text-ink-muted">{t('loading.subtitle')}</p>
        </Card>
      </div>
    );
  }

  // Connection failed before any data arrived — actionable card, socket keeps retrying.
  if (error && !testInfo && candidateList.length === 0) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <EmptyState
          icon={<WifiOff className="text-error-500" />}
          title={t('connError.title')}
          description={error}
          action={
            <Button variant="outline" iconLeft={<ArrowLeft className="size-4" />} onClick={() => navigate('/admin/tests')}>
              {t('connError.back')}
            </Button>
          }
        />
      </div>
    );
  }

  const statTiles = [
    { icon: <Users />, label: t('stats.totalCandidates'), value: stats?.total_candidates ?? candidateList.length, tone: 'neutral' as const },
    { icon: <Activity />, label: t('stats.activeNow'), value: stats?.active ?? 0, tone: 'sage' as const },
    { icon: <AlertTriangle />, label: t('stats.highRisk'), value: stats?.high_risk ?? 0, tone: 'coral' as const },
    { icon: <Flag />, label: t('stats.flagged'), value: stats?.flagged ?? 0, tone: 'amber' as const },
    { icon: <TrendingUp />, label: t('stats.avgProgress'), value: `${stats?.avg_progress ?? 0}%`, tone: 'sage' as const },
    { icon: <Target />, label: t('stats.avgAccuracy'), value: `${stats?.avg_accuracy ?? 0}%`, tone: 'coral' as const },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ── */}
      <PageHeader
        backTo="/admin/tests"
        title={
          <span className="inline-flex items-center gap-3">
            {testInfo?.test_title || t('header.titleFallback')}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-coral-50 px-2.5 py-0.5 text-xs font-semibold text-coral-600 dark:bg-coral-500/15 dark:text-coral-300">
              <Radio className={cn('size-3.5', isConnected && 'animate-pulse')} /> {t('header.live')}
            </span>
          </span>
        }
        description={
          testInfo
            ? t('header.description', { questions: testInfo.total_questions, minutes: testInfo.duration_minutes })
            : t('header.descriptionFallback')
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              iconLeft={<Download className="size-4" />}
              title={t('header.reportTitle')}
              onClick={handleExport}
            >
              {t('header.report')}
            </Button>
            <Badge variant={isConnected ? 'success' : 'error'} size="md" className="inline-flex items-center gap-1.5">
              {isConnected ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
              {isConnected ? t('header.connected') : t('header.reconnecting')}
            </Badge>
            {testInfo && testInfo.admin_count > 1 && (
              <Badge variant="info" size="md" className="inline-flex items-center gap-1.5">
                <Eye className="size-3.5" /> {t('header.watching', { n: testInfo.admin_count })}
              </Badge>
            )}
          </div>
        }
      />

      {/* ── Reconnect banner (non-blocking) ── */}
      {!isConnected && (
        <div className="flex items-center gap-2 rounded-xl border border-error-500/25 bg-error-50 px-4 py-2.5 text-sm text-error-600 dark:bg-error-500/10">
          <WifiOff className="size-4 shrink-0" />
          <span>{error || t('reconnectBanner')}</span>
        </div>
      )}

      {/* ── Stats Cards ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {statTiles.map(t => (
          <StatCard key={t.label} icon={t.icon} label={t.label} value={t.value} tone={t.tone} />
        ))}
      </div>

      {/* ── Controls Bar ── */}
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Search */}
          <div className="lg:max-w-xs lg:flex-1">
            <Input
              leftIcon={<Search className="size-4" />}
              type="text"
              placeholder={t('controls.searchPlaceholder')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Sort dropdown */}
            <div className="flex items-center gap-1.5">
              <Select
                value={sortField}
                onChange={e => setSortField(e.target.value as SortField)}
                className="w-44"
              >
                <option value="risk_score">{t('controls.sort.riskScore')}</option>
                <option value="remaining_seconds">{t('controls.sort.timeRemaining')}</option>
                <option value="questions_attempted">{t('controls.sort.questionsDone')}</option>
                <option value="accuracy_pct">{t('controls.sort.accuracy')}</option>
                <option value="tab_switch_count">{t('controls.sort.tabSwitches')}</option>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))}
                title={sortOrder === 'asc' ? t('controls.ascending') : t('controls.descending')}
                aria-label={t('controls.toggleSortOrder')}
              >
                {sortOrder === 'desc' ? <ArrowDown className="size-4" /> : <ArrowUp className="size-4" />}
              </Button>
            </div>

            {/* View toggle */}
            <div className="inline-flex overflow-hidden rounded-lg border border-border">
              <button
                type="button"
                className={cn(
                  'flex items-center justify-center px-3 py-2 transition-colors',
                  viewMode === 'grid' ? 'bg-primary text-primary-fg' : 'bg-surface text-ink-muted hover:text-ink',
                )}
                onClick={() => setViewMode('grid')}
                title={t('controls.gridView')}
                aria-label={t('controls.gridViewAria')}
              >
                <BarChart3 className="size-4" />
              </button>
              <button
                type="button"
                className={cn(
                  'flex items-center justify-center border-l border-border px-3 py-2 transition-colors',
                  viewMode === 'table' ? 'bg-primary text-primary-fg' : 'bg-surface text-ink-muted hover:text-ink',
                )}
                onClick={() => setViewMode('table')}
                title={t('controls.tableView')}
                aria-label={t('controls.tableViewAria')}
              >
                <FileText className="size-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Status filter chips */}
        <div className="flex flex-wrap items-center gap-2">
          {(['', 'active', 'idle', 'disconnected', 'submitted', 'not_started'] as StatusFilter[]).map(s => (
            <Chip
              key={s || 'all'}
              selected={statusFilter === s}
              count={
                s === '' ? candidateList.length
                  : s === 'active' ? (stats?.active ?? 0)
                  : s === 'disconnected' ? (stats?.disconnected ?? 0)
                  : s === 'submitted' ? (stats?.submitted ?? 0)
                  : undefined
              }
              onClick={() => setStatusFilter(s)}
            >
              {s === '' ? t('filters.all') : t(`status.${s}`)}
            </Chip>
          ))}
        </div>
      </Card>

      {/* ── Results count ── */}
      <div className="-mb-2 text-sm text-ink-muted">
        {t('showingCount', { shown: filteredCandidates.length, total: candidateList.length })}
      </div>

      {/* ── Candidate views ── */}
      {filteredCandidates.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={t('empty.title')}
          description={candidateList.length === 0 ? t('empty.waiting') : t('empty.adjustFilters')}
        />
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filteredCandidates.map(candidate => (
            <Card
              key={candidate.session_id}
              interactive
              accent={candidate.risk_score >= 50 ? 'coral' : undefined}
              className={cn(
                'flex flex-col gap-4 p-5',
                candidate.is_flagged && 'ring-1 ring-amber-400/60',
              )}
              onClick={() => openCandidateDetail(candidate)}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={candidate.user_name || t('card.unknownUser')} size="md" />
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-ink">{candidate.user_name || t('card.unknownUser')}</div>
                    <div className="truncate text-xs text-ink-muted">{candidate.user_email}</div>
                  </div>
                </div>
                <StatusBadge status={candidate.status} t={t} />
              </div>

              {/* Metrics */}
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-ink-faint">{t('card.progress')}</span>
                  <ProgressBar current={candidate.questions_attempted} total={candidate.total_questions} />
                </div>
                <div className="flex items-center justify-between text-sm text-ink-muted">
                  <span className="inline-flex items-center gap-1.5"><Target className="size-3.5" /> {candidate.accuracy_pct}%</span>
                  <span className="inline-flex items-center gap-1.5"><Clock className="size-3.5" /> {formatTime(candidate.remaining_seconds)}</span>
                  <span className="inline-flex items-center gap-1.5"><Eye className="size-3.5" /> {t('qShort', { n: candidate.current_question })}</span>
                </div>
              </div>

              {/* Footer: risk + alerts */}
              <div className="flex items-center justify-between border-t border-border pt-3">
                <RiskIndicator score={candidate.risk_score} t={t} />
                <div className="flex items-center gap-1.5">
                  {candidate.tab_switch_count > 0 && (
                    <Badge variant="warning" className="inline-flex items-center gap-1" title={t('card.tabSwitchesTitle', { n: candidate.tab_switch_count })}>
                      <MonitorSmartphone className="size-3" /> {candidate.tab_switch_count}
                    </Badge>
                  )}
                  {candidate.is_flagged && (
                    <Badge variant="error" className="inline-flex items-center gap-1" title={t('card.flaggedTitle')}>
                      <Flag className="size-3" />
                    </Badge>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                <Button
                  variant={candidate.is_flagged ? 'danger' : 'outline'}
                  size="sm"
                  className="flex-1"
                  iconLeft={<Flag className="size-4" />}
                  onClick={() => handleAction(candidate.is_flagged ? 'UNFLAG' : 'FLAG', candidate)}
                  title={candidate.is_flagged ? t('card.removeFlag') : t('card.flag')}
                >
                  {candidate.is_flagged ? t('card.unflag') : t('card.flag')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAction('SEND_WARNING', candidate)}
                  title={t('card.sendWarning')}
                  aria-label={t('card.sendWarning')}
                >
                  <AlertTriangle className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openCandidateDetail(candidate)}
                  title={t('card.viewDetails')}
                  aria-label={t('card.viewDetails')}
                >
                  <Eye className="size-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        /* ── Table View ── */
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table density="compact">
              <THead>
                <Tr>
                  <Th>{t('table.candidate')}</Th>
                  <Th>{t('table.status')}</Th>
                  <Th>{t('table.progress')}</Th>
                  <Th>{t('table.accuracy')}</Th>
                  <Th>{t('table.timeLeft')}</Th>
                  <Th>{t('table.currentQ')}</Th>
                  <Th>{t('table.risk')}</Th>
                  <Th>{t('table.tabSwitches')}</Th>
                  <Th className="text-right">{t('table.actions')}</Th>
                </Tr>
              </THead>
              <TBody>
                {filteredCandidates.map(candidate => (
                  <Tr
                    key={candidate.session_id}
                    clickable
                    onClick={() => openCandidateDetail(candidate)}
                    className={cn(
                      candidate.is_flagged && 'bg-amber-50/60 dark:bg-amber-500/5',
                      candidate.risk_score >= 50 && 'bg-error-50/50 dark:bg-error-500/5',
                    )}
                  >
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={candidate.user_name || t('table.unknown')} size="sm" />
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-ink">{candidate.user_name || t('table.unknown')}</div>
                          <div className="truncate text-xs text-ink-muted">{candidate.user_email}</div>
                        </div>
                      </div>
                    </Td>
                    <Td><StatusBadge status={candidate.status} t={t} /></Td>
                    <Td className="whitespace-nowrap">{candidate.questions_attempted}/{candidate.total_questions}</Td>
                    <Td className="font-semibold">{candidate.accuracy_pct}%</Td>
                    <Td>
                      <span className={cn('tabular-nums', candidate.remaining_seconds < 60 && 'font-semibold text-error-500')}>
                        {formatTime(candidate.remaining_seconds)}
                      </span>
                    </Td>
                    <Td>{t('qShort', { n: candidate.current_question })}</Td>
                    <Td><RiskIndicator score={candidate.risk_score} t={t} /></Td>
                    <Td>{candidate.tab_switch_count}</Td>
                    <Td onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleAction(candidate.is_flagged ? 'UNFLAG' : 'FLAG', candidate)}
                          title={candidate.is_flagged ? t('table.unflag') : t('table.flag')}
                          aria-label={candidate.is_flagged ? t('table.unflag') : t('table.flag')}
                        >
                          <Flag className={cn('size-4', candidate.is_flagged && 'text-error-500')} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleAction('SEND_WARNING', candidate)}
                          title={t('table.warn')}
                          aria-label={t('table.sendWarningAria')}
                        >
                          <AlertTriangle className="size-4" />
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        </Card>
      )}

      {/* ── Candidate Detail Modal ── */}
      <Modal
        open={!!selectedCandidate}
        onClose={closeDetail}
        size="lg"
        title={
          selectedCandidate ? (
            <div className="flex flex-col">
              <span className="font-display text-lg font-bold text-ink">{selectedCandidate.user_name}</span>
              <span className="text-sm font-normal text-ink-muted">{selectedCandidate.user_email}</span>
            </div>
          ) : undefined
        }
        footer={
          selectedCandidate ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant={selectedCandidate.is_flagged ? 'danger' : 'outline'}
                size="sm"
                iconLeft={<Flag className="size-4" />}
                onClick={() => handleAction(selectedCandidate.is_flagged ? 'UNFLAG' : 'FLAG', selectedCandidate)}
              >
                {selectedCandidate.is_flagged ? t('detail.footer.removeFlag') : t('detail.footer.flagUser')}
              </Button>
              <Button variant="outline" size="sm" iconLeft={<AlertTriangle className="size-4" />} onClick={() => handleAction('SEND_WARNING', selectedCandidate)}>
                {t('detail.footer.sendWarning')}
              </Button>
              <Button variant="outline" size="sm" iconLeft={<MessageSquare className="size-4" />} onClick={() => handleAction('ADD_NOTE', selectedCandidate)}>
                {t('detail.footer.addNote')}
              </Button>
              <Button variant="danger" size="sm" iconLeft={<Send className="size-4" />} onClick={() => handleAction('FORCE_SUBMIT', selectedCandidate)}>
                {t('detail.footer.forceSubmit')}
              </Button>
            </div>
          ) : undefined
        }
      >
        {selectedCandidate && (
          detailLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-ink-muted">
              <Spinner />
              <span className="text-sm">{t('detail.loading')}</span>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {/* Status & Risk */}
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={selectedCandidate.status} t={t} />
                <RiskIndicator score={selectedCandidate.risk_score} t={t} />
                {selectedCandidate.is_flagged && (
                  <Badge variant="error" className="inline-flex items-center gap-1"><Flag className="size-3" /> {t('detail.flagged')}</Badge>
                )}
              </div>

              {/* Progress Stats */}
              <section>
                <h4 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-ink-faint">{t('detail.progress')}</h4>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: t('detail.stats.questionsAttempted'), value: `${selectedCandidate.questions_attempted} / ${selectedCandidate.total_questions}` },
                    { label: t('detail.stats.correctAnswers'), value: selectedCandidate.correct_answers, className: 'text-success-600' },
                    { label: t('detail.stats.wrongAnswers'), value: selectedCandidate.wrong_answers, className: 'text-error-500' },
                    { label: t('detail.stats.accuracy'), value: `${selectedCandidate.accuracy_pct}%` },
                    { label: t('detail.stats.timeRemaining'), value: formatTime(selectedCandidate.remaining_seconds), className: selectedCandidate.remaining_seconds < 60 ? 'text-error-500' : '' },
                    { label: t('detail.stats.currentQuestion'), value: t('qShort', { n: selectedCandidate.current_question }) },
                    { label: t('detail.stats.avgTimeQuestion'), value: selectedCandidate.avg_time_per_question_ms ? (selectedCandidate.avg_time_per_question_ms / 1000).toFixed(1) + 's' : '—' },
                    { label: t('detail.stats.fastestQuestion'), value: selectedCandidate.fastest_question_ms ? (selectedCandidate.fastest_question_ms / 1000).toFixed(1) + 's' : '—' },
                  ].map(stat => (
                    <div key={stat.label} className="rounded-lg bg-surface-sunken p-3">
                      <div className="text-xs text-ink-muted">{stat.label}</div>
                      <div className={cn('mt-0.5 font-display text-lg font-bold text-ink', stat.className)}>{stat.value}</div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Behavioral Alerts */}
              <section>
                <h4 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-ink-faint">{t('detail.behavioralIndicators')}</h4>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className={cn(
                    'flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-sm',
                    selectedCandidate.tab_switch_count > 3 && 'border-amber-400/50 bg-amber-50 text-amber-700 dark:bg-amber-500/10',
                  )}>
                    <MonitorSmartphone className="size-4 shrink-0" />
                    <span>{t('detail.behavioral.tabSwitches', { n: selectedCandidate.tab_switch_count })}</span>
                  </div>
                  <div className={cn(
                    'flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-sm',
                    selectedCandidate.fullscreen_exit_count > 0 && 'border-amber-400/50 bg-amber-50 text-amber-700 dark:bg-amber-500/10',
                  )}>
                    <AlertCircle className="size-4 shrink-0" />
                    <span>{t('detail.behavioral.fullscreenExits', { n: selectedCandidate.fullscreen_exit_count })}</span>
                  </div>
                  <div className={cn(
                    'flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-sm',
                    selectedCandidate.copy_paste_count > 0 && 'border-error-500/50 bg-error-50 text-error-600 dark:bg-error-500/10',
                  )}>
                    <Zap className="size-4 shrink-0" />
                    <span>{t('detail.behavioral.copyPaste', { n: selectedCandidate.copy_paste_count })}</span>
                  </div>
                </div>
              </section>

              {/* Suspicious Flags */}
              {detailData?.suspicious_flags?.length > 0 && (
                <section>
                  <h4 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-ink-faint">{t('detail.suspiciousFlags')}</h4>
                  <div className="flex flex-col gap-2">
                    {detailData.suspicious_flags.map((f: any) => (
                      <div
                        key={f.id}
                        className={cn(
                          'flex items-start gap-2.5 rounded-lg border border-l-4 border-border bg-surface-sunken p-3',
                          f.severity === 'high' ? 'border-l-error-500' : f.severity === 'medium' ? 'border-l-amber-500' : 'border-l-info-500',
                        )}
                      >
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                        <div className="min-w-0">
                          <div className="font-semibold capitalize text-ink">{f.rule_name.replace(/_/g, ' ')}</div>
                          <div className="text-sm text-ink-muted">{f.details}</div>
                          <div className="mt-0.5 text-xs text-ink-faint">{f.detected_at ? new Date(f.detected_at).toLocaleTimeString() : ''}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Event Timeline */}
              {detailData?.events?.length > 0 && (
                <section>
                  <h4 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-ink-faint">{t('detail.activityTimeline')}</h4>
                  <div className="flex flex-col gap-2 border-l-2 border-border pl-4">
                    {detailData.events.slice(-30).reverse().map((e: any, i: number) => (
                      <div key={e.id || i} className="relative flex items-center gap-2 text-sm">
                        <span className="absolute -left-[21px] size-2 rounded-full bg-primary" />
                        <span className="font-medium capitalize text-ink">{t(`eventTypes.${e.event_type}`, { defaultValue: e.event_type.replace(/_/g, ' ') })}</span>
                        {e.question_id && <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs text-ink-muted">{t('qShort', { n: e.question_id })}</span>}
                        <span className="ml-auto text-xs text-ink-faint">{e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : ''}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Admin Actions History */}
              {detailData?.admin_actions?.length > 0 && (
                <section>
                  <h4 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-ink-faint">{t('detail.adminActions')}</h4>
                  <div className="flex flex-col gap-2">
                    {detailData.admin_actions.map((a: any) => (
                      <div key={a.id} className="flex items-start gap-2.5 rounded-lg bg-surface-sunken p-3">
                        <Shield className="mt-0.5 size-4 shrink-0 text-primary" />
                        <div className="min-w-0">
                          <div className="font-semibold text-ink">{t(`actionTypes.${a.action_type}`, { defaultValue: a.action_type })}</div>
                          {a.notes && <div className="text-sm text-ink-muted">{a.notes}</div>}
                          <div className="mt-0.5 text-xs text-ink-faint">{a.admin_email} · {a.timestamp ? new Date(a.timestamp).toLocaleTimeString() : ''}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )
        )}
      </Modal>

      {/* ── Action Confirmation Modal ── */}
      <Modal
        open={!!showActionModal}
        onClose={() => setShowActionModal(null)}
        size="sm"
        title={
          showActionModal?.type === 'FORCE_SUBMIT' ? t('actionModal.titleForceSubmit')
            : showActionModal?.type === 'SEND_WARNING' ? t('actionModal.titleSendWarning')
            : showActionModal?.type === 'ADD_NOTE' ? t('actionModal.titleAddNote')
            : undefined
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setShowActionModal(null)}>{t('actionModal.cancel')}</Button>
            <Button variant={showActionModal?.type === 'FORCE_SUBMIT' ? 'danger' : 'primary'} onClick={confirmAction}>
              {showActionModal?.type === 'FORCE_SUBMIT' ? t('actionModal.confirmForceSubmit')
                : showActionModal?.type === 'SEND_WARNING' ? t('actionModal.confirmSendWarning') : t('actionModal.confirmSaveNote')}
            </Button>
          </>
        }
      >
        {showActionModal && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink-muted">
              {t('actionModal.targetLabel')} <strong className="text-ink">{showActionModal.candidate.user_name}</strong>
            </p>
            {showActionModal.type === 'FORCE_SUBMIT' && (
              <div className="flex items-start gap-2 rounded-lg border border-error-500/25 bg-error-50 px-3 py-2.5 text-sm text-error-600 dark:bg-error-500/10">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{t('actionModal.forceSubmitWarning')}</span>
              </div>
            )}
            <textarea
              className={cn(inputClasses(), 'resize-y')}
              placeholder={
                showActionModal.type === 'SEND_WARNING' ? t('actionModal.placeholderWarning')
                  : showActionModal.type === 'ADD_NOTE' ? t('actionModal.placeholderNote')
                  : t('actionModal.placeholderForceSubmit')
              }
              value={actionNotes}
              onChange={e => setActionNotes(e.target.value)}
              rows={3}
            />
          </div>
        )}
      </Modal>
    </div>
  );
};

export default AdminLiveMonitorPage;
