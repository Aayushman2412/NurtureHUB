/**
 * Public privacy notice and rights request form.
 *
 * Deliberately outside the login wall. The DPDP Act gives people the right to
 * know what is held about them and a route to complain about it, and putting
 * either behind a sign-in makes the right theoretical for exactly the people
 * most likely to need it — a mother who no longer has the phone she registered
 * with cannot sign in to ask what you hold about her child.
 *
 * Nothing here reads or returns a record. It opens a ticket with a due date;
 * a human verifies who the person is before anything is disclosed or deleted.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import client from '../api/client';
import { Alert, Button, Card, Field, Input, Select, Spinner } from '../components/ui';
import LanguageSwitcher from '../components/LanguageSwitcher';

interface Notice {
  version: string;
  language: string;
  collector: string;
  contact: { officer: string; email: string; phone: string };
  purposes: { purpose: string; label: string; description: string; essential: boolean }[];
  rights: string[];
  children: string;
  sharing: string;
  how_to_exercise: string;
}

const REQUEST_TYPES = [
  { value: 'access', label: 'See what information you hold about me' },
  { value: 'correction', label: 'Correct something that is wrong' },
  { value: 'erasure', label: 'Delete my information' },
  { value: 'grievance', label: 'Make a complaint' },
  { value: 'nominate', label: 'Nominate someone to act for me' },
];

const PrivacyPage: React.FC = () => {
  const { i18n } = useTranslation();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    request_type: 'access',
    subject_identifier: '',
    requested_by: '',
    requester_relationship: '',
    contact: '',
    details: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ reference: string; due_at: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    client
      .get<Notice>('/api/privacy/notice', { params: { language: i18n.language || 'en' } })
      .then(r => setNotice(r.data))
      .catch(() => setError('The privacy notice could not be loaded. Please try again shortly.'))
      .finally(() => setLoading(false));
  }, [i18n.language]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.subject_identifier.trim() || !form.requested_by.trim() || !form.contact.trim()) {
      setError('Please fill in your name, how we can reach you, and whose information this is about.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await client.post('/api/privacy/requests', form);
      setSubmitted({ reference: res.data.reference, due_at: res.data.due_at });
    } catch (err: any) {
      setError(
        err.response?.data?.detail ||
          'Your request could not be submitted. Please try again, or contact us directly.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-sunken">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-4">
          <Link to="/" className="flex items-center gap-2 font-display font-bold text-ink">
            <ShieldCheck className="size-5 text-primary-ink" /> NurtureHUB
          </Link>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-8">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">Your information</h1>
          {notice && (
            <p className="mt-2 text-sm text-ink-muted">
              How {notice.collector} looks after the information you and your health worker record in
              NurtureHUB. Notice version {notice.version}.
            </p>
          )}
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {notice && (
          <>
            <Card className="p-6">
              <h2 className="font-display text-xl font-bold text-ink">What we use it for</h2>
              <ul className="mt-3 flex flex-col gap-3">
                {notice.purposes.map(p => (
                  <li key={p.purpose}>
                    <div className="font-semibold text-ink">
                      {p.label}
                      {!p.essential && (
                        <span className="ml-2 text-xs font-normal text-ink-muted">
                          (you can say no to this)
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-ink-muted">{p.description}</p>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="p-6">
              <h2 className="font-display text-xl font-bold text-ink">Children</h2>
              <p className="mt-2 text-sm text-ink">{notice.children}</p>
              <h2 className="mt-5 font-display text-xl font-bold text-ink">Who else sees it</h2>
              <p className="mt-2 text-sm text-ink">{notice.sharing}</p>
            </Card>

            <Card className="p-6">
              <h2 className="font-display text-xl font-bold text-ink">Your rights</h2>
              <ul className="mt-3 list-disc pl-5 text-sm text-ink">
                {notice.rights.map(r => (
                  <li key={r} className="mb-1">
                    {r}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-ink-muted">{notice.how_to_exercise}</p>
              <p className="mt-2 text-sm text-ink-muted">
                {notice.contact.officer} ·{' '}
                <a href={`mailto:${notice.contact.email}`} className="text-primary-ink hover:underline">
                  {notice.contact.email}
                </a>
                {notice.contact.phone ? ` · ${notice.contact.phone}` : ''}
              </p>
            </Card>
          </>
        )}

        <Card className="p-6" id="request">
          <h2 className="font-display text-xl font-bold text-ink">Ask us about your information</h2>

          {submitted ? (
            <Alert variant="success" className="mt-4">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
                <div>
                  <p className="font-semibold">
                    Your request has been recorded. Please keep this reference:
                  </p>
                  <p className="my-2 font-mono text-lg">{submitted.reference}</p>
                  <p className="text-sm">
                    We will contact you to confirm who you are before we act on it, and we will
                    reply by{' '}
                    {new Date(submitted.due_at).toLocaleDateString(undefined, { dateStyle: 'long' })}.
                  </p>
                </div>
              </div>
            </Alert>
          ) : (
            <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
              <Field label="What would you like us to do?">
                <Select
                  value={form.request_type}
                  onChange={e => setForm({ ...form, request_type: e.target.value })}
                >
                  {REQUEST_TYPES.map(t => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Whose information is this about?">
                <Input
                  value={form.subject_identifier}
                  onChange={e => setForm({ ...form, subject_identifier: e.target.value })}
                  placeholder="Her name, or her registration number if you have it"
                />
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Your name">
                  <Input
                    value={form.requested_by}
                    onChange={e => setForm({ ...form, requested_by: e.target.value })}
                  />
                </Field>
                <Field label="How we can reach you">
                  <Input
                    value={form.contact}
                    onChange={e => setForm({ ...form, contact: e.target.value })}
                    placeholder="Phone number or email"
                  />
                </Field>
              </div>

              <Field label="Are you asking for yourself, or for someone else?">
                <Input
                  value={form.requester_relationship}
                  onChange={e => setForm({ ...form, requester_relationship: e.target.value })}
                  placeholder="e.g. myself, my child, my daughter-in-law"
                />
              </Field>

              <Field label="Anything else we should know">
                <textarea
                  className="w-full rounded-lg border border-border bg-surface p-3 text-sm"
                  rows={4}
                  value={form.details}
                  onChange={e => setForm({ ...form, details: e.target.value })}
                />
              </Field>

              <p className="text-[13px] text-ink-muted">
                Please do not include medical details here. We only need enough to find your record
                and to be sure it is you.
              </p>

              <Button type="submit" loading={submitting} size="lg">
                Send request
              </Button>
            </form>
          )}
        </Card>

        <p className="pb-8 text-center text-[13px] text-ink-muted">
          If you are not satisfied with our answer, you may complain to the Data Protection Board of
          India.
        </p>
      </main>
    </div>
  );
};

export default PrivacyPage;
