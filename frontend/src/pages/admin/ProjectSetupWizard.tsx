import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Rocket, Save } from 'lucide-react';
import { Alert, Button, Checkbox, FieldLabel, Modal, Select, Spinner } from '../../components/ui';
import client from '../../api/client';
import { inputClasses } from '../../components/ui/Input';
import { cn } from '../../utils/cn';

interface SetupSource {
  id: number;
  name: string;
  level: string;
  phase_count: number;
  tutorial_count: number;
  test_count: number;
}

interface SetupFormVersion {
  version_number: number;
  created_on: string | null;
  description: string;
}

interface SetupForm {
  form_key: string;
  title: string;
  default_version_number: number | null;
  current_version_number: number | null;
  versions: SetupFormVersion[];
}

interface SetupOptions {
  project: { id: number; name: string; level: string };
  can_have_districts: boolean;
  sources: SetupSource[];
  forms: SetupForm[];
}

interface Props {
  projectId: number;
  onClose: () => void;
  onDone: () => void;
}

/**
 * "Set up this project" — the follow-through after creating a project, so an
 * admin does not have to walk every content screen and every form to point a
 * new district at the right material.
 *
 * Three things in one submit: copy a syllabus from an existing project, pin a
 * version of each form, and (for a state) create its districts.
 */
const ProjectSetupWizard: React.FC<Props> = ({ projectId, onClose, onDone }) => {
  const { t } = useTranslation('admin');
  const [options, setOptions] = useState<SetupOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [copyFrom, setCopyFrom] = useState<string>('');
  const [copyTests, setCopyTests] = useState(false);
  const [formVersions, setFormVersions] = useState<Record<string, string>>({});
  const [districtNames, setDistrictNames] = useState('');
  const [childrenInherit, setChildrenInherit] = useState(true);

  useEffect(() => {
    setLoading(true);
    client
      .get(`/api/admin/projects/${projectId}/setup-options`)
      .then(res => {
        const data: SetupOptions = res.data;
        setOptions(data);
        setFormVersions(
          Object.fromEntries(
            data.forms.map(f => [f.form_key, f.current_version_number ? String(f.current_version_number) : '']),
          ),
        );
      })
      .catch((err: { response?: { data?: { detail?: string } } }) =>
        setError(err?.response?.data?.detail || t('setup.loadFailed')))
      .finally(() => setLoading(false));
  }, [projectId, t]);

  const submit = async () => {
    if (!options) return;
    setSaving(true);
    setError('');
    // Only send forms the admin actually changed — an untouched form must not
    // gain a pin it did not have.
    const changed: Record<string, number | null> = {};
    for (const form of options.forms) {
      const picked = formVersions[form.form_key] ?? '';
      const before = form.current_version_number ? String(form.current_version_number) : '';
      if (picked !== before) changed[form.form_key] = picked === '' ? null : Number(picked);
    }
    try {
      await client.post(`/api/admin/projects/${projectId}/setup`, {
        copy_content_from: copyFrom === '' ? null : Number(copyFrom),
        copy_tests: copyTests,
        form_versions: changed,
        child_districts: districtNames.split('\n').map(n => n.trim()).filter(Boolean),
        children_inherit: childrenInherit,
      });
      onDone();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || t('setup.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <Rocket className="size-4" />
          {t('setup.title', { name: options?.project.name ?? '' })}
        </span>
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>{t('setup.later')}</Button>
          <Button iconLeft={<Save className="size-4" />} loading={saving} disabled={saving || loading}
            onClick={() => void submit()}>
            {t('setup.apply')}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="m-0 text-[13px] text-ink-muted">{t('setup.intro')}</p>

          {/* 1. Content */}
          <section>
            <h4 className="mb-1 mt-0 text-sm font-bold text-ink">{t('setup.contentTitle')}</h4>
            <p className="mb-2 mt-0 text-[12px] text-ink-faint">{t('setup.contentHint')}</p>
            <Select value={copyFrom} onChange={e => setCopyFrom(e.target.value)}>
              <option value="">{t('setup.startEmpty')}</option>
              {options?.sources.map(source => (
                <option key={source.id} value={source.id}>
                  {source.name} — {t('setup.sourceMeta', {
                    phases: source.phase_count,
                    tutorials: source.tutorial_count,
                    tests: source.test_count,
                  })}
                </option>
              ))}
            </Select>
            {copyFrom !== '' && (
              <div className="mt-2">
                <Checkbox checked={copyTests} onChange={e => setCopyTests(e.target.checked)}
                  label={t('setup.copyTests')} />
                <p className="mt-1 pl-6.5 text-[11px] text-ink-faint">{t('setup.copyTestsHint')}</p>
              </div>
            )}
          </section>

          {/* 2. Form versions */}
          <section>
            <h4 className="mb-1 mt-0 text-sm font-bold text-ink">{t('setup.formsTitle')}</h4>
            <p className="mb-2 mt-0 text-[12px] text-ink-faint">{t('setup.formsHint')}</p>
            <div className="flex flex-col gap-2">
              {options?.forms.map(form => (
                <div key={form.form_key} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_1.3fr]">
                  <span className="text-[13px] font-semibold text-ink">{form.title}</span>
                  <Select
                    value={formVersions[form.form_key] ?? ''}
                    onChange={e => setFormVersions({ ...formVersions, [form.form_key]: e.target.value })}
                  >
                    <option value="">
                      {form.default_version_number
                        ? t('setup.followDefault', { n: form.default_version_number })
                        : t('setup.followDefaultPlain')}
                    </option>
                    {form.versions.map(v => (
                      <option key={v.version_number} value={v.version_number}>
                        v{v.version_number}
                        {v.created_on ? ` · ${v.created_on}` : ''} — {v.description}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          </section>

          {/* 3. Districts inside a state project */}
          {options?.can_have_districts && (
            <section>
              <h4 className="mb-1 mt-0 text-sm font-bold text-ink">{t('setup.districtsTitle')}</h4>
              <p className="mb-2 mt-0 text-[12px] text-ink-faint">{t('setup.districtsHint')}</p>
              <FieldLabel size="sm">{t('setup.districtsLabel')}</FieldLabel>
              <textarea
                className={cn(inputClasses(), 'resize-y font-mono text-[13px]')}
                rows={5}
                placeholder={t('setup.districtsPlaceholder')}
                value={districtNames}
                onChange={e => setDistrictNames(e.target.value)}
              />
              <div className="mt-2">
                <Checkbox checked={childrenInherit} onChange={e => setChildrenInherit(e.target.checked)}
                  label={t('setup.childrenInherit')} />
                <p className="mt-1 pl-6.5 text-[11px] text-ink-faint">{t('setup.childrenInheritHint')}</p>
              </div>
            </section>
          )}

          {error && <Alert variant="error">{error}</Alert>}
        </div>
      )}
    </Modal>
  );
};

export default ProjectSetupWizard;
