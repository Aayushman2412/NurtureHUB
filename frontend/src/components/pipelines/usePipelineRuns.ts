import { useCallback, useEffect, useRef, useState } from 'react';
import type { PipelineKey, PipelineRun } from '../../api/pipelines';
import { getPipelineRun, listPipelineRuns } from '../../api/pipelines';
import { isRunActive } from './helpers';

/** Run history + selected-run detail with automatic polling while a run is active.
 *
 * Every fetch is tagged with the scope (pipeline+variant) it was issued for and
 * an epoch counter. A response whose scope no longer matches is discarded — a
 * slow request for the previous project must never repopulate the list or
 * auto-select a run belonging to another project.
 */
export function usePipelineRuns(pipeline: PipelineKey, variant?: string) {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedRun, setSelectedRun] = useState<PipelineRun | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);

  const selectedIdRef = useRef<number | null>(null);
  selectedIdRef.current = selectedId;

  const scope = `${pipeline}:${variant ?? ''}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const loadRuns = useCallback(() => {
    const issuedFor = `${pipeline}:${variant ?? ''}`;
    return listPipelineRuns(pipeline, variant)
      .then(res => {
        if (scopeRef.current !== issuedFor) return [] as PipelineRun[];
        setRuns(res.runs);
        // Auto-select the newest run when nothing is selected yet.
        if (selectedIdRef.current == null && res.runs.length > 0) {
          setSelectedId(res.runs[0].id);
        }
        return res.runs;
      })
      .catch(() => [] as PipelineRun[])
      .finally(() => {
        if (scopeRef.current === issuedFor) setRunsLoading(false);
      });
  }, [pipeline, variant]);

  const loadSelected = useCallback((runId: number) => {
    const issuedFor = scopeRef.current;
    setSelectedLoading(true);
    return getPipelineRun(runId)
      .then(run => {
        if (selectedIdRef.current === runId && scopeRef.current === issuedFor) {
          setSelectedRun(run);
        }
      })
      .catch(() => {
        if (selectedIdRef.current === runId && scopeRef.current === issuedFor) {
          setSelectedRun(null);
        }
      })
      .finally(() => {
        if (selectedIdRef.current === runId && scopeRef.current === issuedFor) {
          setSelectedLoading(false);
        }
      });
  }, []);

  // Reset when the scope (pipeline/variant) changes.
  useEffect(() => {
    setRuns([]);
    setRunsLoading(true);
    setSelectedId(null);
    setSelectedRun(null);
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (selectedId != null) void loadSelected(selectedId);
    else setSelectedRun(null);
  }, [selectedId, loadSelected]);

  // Poll while any run is queued/running so status + outputs appear live.
  const anyActive = runs.some(isRunActive) || (selectedRun != null && isRunActive(selectedRun));
  useEffect(() => {
    if (!anyActive) return;
    const interval = window.setInterval(() => {
      void loadRuns();
      if (selectedIdRef.current != null) void loadSelected(selectedIdRef.current);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [anyActive, loadRuns, loadSelected]);

  const refresh = useCallback(() => {
    void loadRuns();
    if (selectedIdRef.current != null) void loadSelected(selectedIdRef.current);
  }, [loadRuns, loadSelected]);

  return {
    runs,
    runsLoading,
    selectedRun,
    selectedLoading,
    selectRun: setSelectedId,
    refresh,
  };
}
