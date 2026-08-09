import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, Download, FlaskConical, Import, RefreshCw } from 'lucide-react';
import {
  Badge, Button, Card, CardBody, EmptyState, PageHeader, Select, Spinner,
  Table, TBody, Td, Th, THead, Tr,
} from '../../components/ui';
import { useToast } from '../../context/ToastContext';
import {
  downloadRawFile, generateRawSet, getRawSet, ingestRawSet,
  type RawPipeline, type RawSet,
} from '../../api/rawdata';
import { getPipelineOverview } from '../../api/pipelines';
import { formatBytes } from '../../components/pipelines/helpers';

/** Projects come from the admin's project list, so a newly added state or
 *  district is immediately selectable here. */
interface PipelineProject { code: string; name: string; analysis_level?: string }

/** Database → Raw Data: generate the pipelines' raw input files from the data
 *  learners collected in NurtureHUB, then ingest them into the pipeline
 *  inputs with one click (manual upload stays available on the pipeline pages). */
const AdminRawDataPage: React.FC = () => {
  const { t } = useTranslation('pipelines');
  const { showToast } = useToast();
  const [tab, setTab] = useState<RawPipeline>('crosstabs');
  const [project, setProject] = useState<string>('UJ');
  const [projectList, setProjectList] = useState<PipelineProject[]>([]);
  const [set, setSet] = useState<RawSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const projectParam = tab === 'crosstabs' ? project : undefined;

  const refresh = () => {
    setLoading(true);
    getRawSet(tab, projectParam)
      .then(setSet)
      .catch(() => setSet(null))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [tab, project]);

  useEffect(() => {
    getPipelineOverview()
      .then(data => {
        const list: PipelineProject[] = data.crosstabs?.projects ?? [];
        setProjectList(list);
        // Keep the selection valid when projects change underneath us.
        if (list.length > 0 && !list.some(p => p.code === project)) {
          setProject(list[0].code);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (key: string, action: () => Promise<unknown>, successMsg: string) => {
    setBusy(key);
    try {
      await action();
      showToast(successMsg, 'success');
      refresh();
    } catch {
      showToast(t('rawdata.failed'), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('rawdata.title')}
        description={t('rawdata.description')}
      />

      {/* Pipeline tabs + project picker */}
      <div className="flex flex-wrap items-center gap-2">
        {(['crosstabs', 'masd'] as const).map(key => (
          <Button
            key={key}
            variant={tab === key ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setTab(key)}
          >
            {t(`rawdata.tab.${key}`)}
          </Button>
        ))}
        {tab === 'crosstabs' && (
          <div className="ml-2 w-40">
            <Select value={project} onChange={e => setProject(e.target.value)}>
              {projectList.map(p => (
                <option key={p.code} value={p.code}>
                  {p.name}{p.analysis_level === 'state' ? ` — ${t('rawdata.stateSuffix')}` : ''}
                </option>
              ))}
            </Select>
          </div>
        )}
        <span className="ml-auto" />
        {set?.mock && (
          <Badge variant="warning">
            <FlaskConical className="mr-1 size-3.5" /> {t('rawdata.mockBadge')}
          </Badge>
        )}
      </div>

      <Card>
        <CardBody className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Database className="size-4 text-coral-600 dark:text-coral-300" />
            <span className="font-display text-sm font-bold text-ink">
              {t('rawdata.currentSet')}
            </span>
            <span className="ml-auto" />
            <Button
              size="sm"
              iconLeft={<RefreshCw className="size-4" />}
              loading={busy === 'generate'}
              disabled={busy !== null}
              onClick={() => void run('generate', () => generateRawSet(tab, projectParam), t('rawdata.generated'))}
            >
              {t('rawdata.generate')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              iconLeft={<Import className="size-4" />}
              loading={busy === 'ingest'}
              disabled={busy !== null || !set || set.files.length === 0}
              onClick={() => void run('ingest', () => ingestRawSet(tab, projectParam), t('rawdata.ingested'))}
            >
              {t('rawdata.ingest')}
            </Button>
          </div>
          <p className="text-[13px] text-ink-muted">{t(`rawdata.hint.${tab}`)}</p>

          {loading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : !set || set.files.length === 0 ? (
            <EmptyState
              icon={<Database className="size-8" />}
              title={t('rawdata.emptyTitle')}
              description={t('rawdata.emptyBody')}
            />
          ) : (
            <Table density="compact">
              <THead>
                <Tr>
                  <Th>{t('rawdata.colFile')}</Th>
                  <Th>{t('rawdata.colRows')}</Th>
                  <Th>{t('rawdata.colSize')}</Th>
                  <Th> </Th>
                </Tr>
              </THead>
              <TBody>
                {set.files.map(file => (
                  <Tr key={file.path}>
                    <Td className="font-medium text-ink">{file.name}</Td>
                    <Td className="tabular-nums">{file.rows.toLocaleString()}</Td>
                    <Td className="tabular-nums">{formatBytes(file.size)}</Td>
                    <Td>
                      <Button
                        variant="ghost" size="sm"
                        title={t('rawdata.download')}
                        loading={busy === `dl:${file.path}`}
                        onClick={() => void run(`dl:${file.path}`,
                          () => downloadRawFile(tab, file.path, projectParam), t('rawdata.downloaded'))}
                      >
                        <Download className="size-4" />
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
};

export default AdminRawDataPage;
