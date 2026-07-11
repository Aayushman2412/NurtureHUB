import React, { useState } from 'react';
import {
  Award, BookOpen, ClipboardList, Inbox, Lock, Plus, Search, TrendingUp, User,
} from 'lucide-react';
import {
  Alert, Avatar, Badge, Button, Card, CardBody, Checkbox, Chip, Dropdown, EmptyState,
  Input, Modal, PageHeader, PageLoader, PasswordInput, ProgressBar, ProgressRing, Radio,
  Select, Skeleton, Spinner, StatCard, Stepper, Table, Tabs, TBody, Td, Th, THead, Tr,
} from '../../components/ui';
import { useTheme } from '../../context/ThemeContext';

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="mb-10">
    <h3 className="font-display font-bold text-lg text-ink mb-4 pb-2 border-b border-border">{title}</h3>
    <div className="flex flex-wrap items-start gap-4">{children}</div>
  </section>
);

/** DEV-only component gallery — every primitive × variant, both modes. */
const StyleguidePage: React.FC = () => {
  const { darkMode, toggleDarkMode } = useTheme();
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState('personal');
  const [chip, setChip] = useState('all');

  return (
    <div className="min-h-screen bg-background text-ink p-8 max-w-6xl mx-auto">
      <PageHeader
        title="NurtureHUB Styleguide"
        description="Every ui primitive in every variant. DEV only."
        actions={<Button variant="outline" onClick={toggleDarkMode}>{darkMode ? 'Light' : 'Dark'} mode</Button>}
      />

      <Section title="Buttons">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button loading>Loading</Button>
        <Button disabled>Disabled</Button>
        <Button size="sm" iconLeft={<Plus className="size-4" />}>Small</Button>
        <Button size="lg">Large</Button>
      </Section>

      <Section title="Coral primary vs. error crimson (must never be confusable)">
        <Button>Primary action</Button>
        <Button variant="danger">Destructive action</Button>
        <Badge variant="error">Failed</Badge>
        <Badge variant="coral">Coral badge</Badge>
      </Section>

      <Section title="Badges">
        <Badge variant="success">Passed</Badge>
        <Badge variant="error">Failed</Badge>
        <Badge variant="warning">Pending</Badge>
        <Badge variant="info">Info</Badge>
        <Badge variant="neutral">Neutral</Badge>
        <Badge variant="teal">Teal</Badge>
        <Badge variant="coral" size="md">Coral md</Badge>
      </Section>

      <Section title="Inputs">
        <div className="w-64"><Input placeholder="Plain input" /></div>
        <div className="w-64"><Input placeholder="With icon" leftIcon={<Search />} /></div>
        <div className="w-64"><Input placeholder="Error state" error="This field is required" /></div>
        <div className="w-64"><Input placeholder="Disabled" disabled /></div>
        <div className="w-64"><PasswordInput placeholder="Password" /></div>
        <div className="w-64">
          <Select defaultValue="">
            <option value="" disabled>Select district</option>
            <option>Gorakhpur</option>
            <option>Lucknow</option>
          </Select>
        </div>
        <div className="w-64"><Select disabled><option>Disabled until parent chosen</option></Select></div>
        <Checkbox label="Checkbox" defaultChecked />
        <Radio name="sg" label="Radio A" defaultChecked />
        <Radio name="sg" label="Radio B" />
      </Section>

      <Section title="Cards">
        <Card className="w-56"><CardBody>Plain card</CardBody></Card>
        <Card interactive className="w-56"><CardBody>Interactive card</CardBody></Card>
        <Card locked className="w-56"><CardBody><Lock className="size-4 inline mr-1" />Locked card</CardBody></Card>
        <Card accent="teal" className="w-56"><CardBody>Teal accent</CardBody></Card>
        <Card accent="coral" className="w-56"><CardBody>Coral accent</CardBody></Card>
      </Section>

      <Section title="Stat cards">
        <StatCard icon={<BookOpen />} label="Completed Tutorials" value="12/30" tone="coral" className="w-64" />
        <StatCard icon={<Award />} label="Assessments Passed" value="4/6" tone="amber" className="w-64" />
        <StatCard icon={<TrendingUp />} label="Progress" value="63%" trend="+12% this week" tone="teal" className="w-64" />
      </Section>

      <Section title="Progress">
        <div className="w-64 space-y-3">
          <ProgressBar value={72} />
          <ProgressBar value={45} tone="coral" size="lg" />
          <ProgressBar value={90} tone="sage" size="sm" />
        </div>
        <ProgressRing value={63} />
        <ProgressRing value={88} size={64} strokeWidth={6} />
      </Section>

      <Section title="Tabs & chips">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'personal', label: 'Personal Details', icon: <User className="size-4" /> },
            { value: 'professional', label: 'Professional Info', icon: <ClipboardList className="size-4" /> },
          ]}
          className="w-full"
        />
        <div className="flex gap-2">
          {['all', 'completed', 'pending'].map(f => (
            <Chip key={f} selected={chip === f} onClick={() => setChip(f)} count={f === 'all' ? 24 : 8}>
              {f}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Alerts">
        <div className="w-full space-y-3">
          <Alert variant="info" title="Heads up">Informational message with teal accent.</Alert>
          <Alert variant="warning" title="Important">You cannot pause the assessment once started.</Alert>
          <Alert variant="success">Profile saved successfully.</Alert>
          <Alert variant="error" title="Submission failed">Please check your connection and try again.</Alert>
        </div>
      </Section>

      <Section title="Table">
        <Table className="w-full">
          <THead>
            <Tr><Th>Assessment</Th><Th>Score</Th><Th>Status</Th></Tr>
          </THead>
          <TBody>
            <Tr clickable><Td>Nutrition Basics</Td><Td>84%</Td><Td><Badge variant="success">Passed</Badge></Td></Tr>
            <Tr clickable><Td>Child Development</Td><Td>42%</Td><Td><Badge variant="error">Failed</Badge></Td></Tr>
          </TBody>
        </Table>
      </Section>

      <Section title="Avatar / Stepper / Dropdown">
        <Avatar name="Google Test User" size="sm" />
        <Avatar name="Google Test User" />
        <Avatar name="Anganwadi Worker" size="lg" />
        <Stepper steps={['Account', 'Verify', 'Profile']} current={1} />
        <Dropdown
          trigger={open => <Button variant="outline" size="sm">{open ? 'Close' : 'Open'} menu</Button>}
          items={[
            { key: 'a', label: 'Gorakhpur', onSelect: () => {}, selected: true },
            { key: 'b', label: 'Lucknow', onSelect: () => {} },
          ]}
        />
      </Section>

      <Section title="Empty / Loading / Skeleton">
        <EmptyState
          icon={<Inbox />}
          title="No assessments yet"
          description="Finish a course phase to unlock your first assessment."
          action={<Button size="sm">Browse tutorials</Button>}
          className="w-80"
        />
        <div className="w-64 space-y-2">
          <Skeleton variant="line" />
          <Skeleton variant="line" className="w-2/3" />
          <Skeleton variant="block" />
          <Skeleton variant="circle" />
        </div>
        <Spinner />
      </Section>

      <Section title="Modal">
        <Button onClick={() => setModalOpen(true)}>Open modal</Button>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Submit assessment?"
          footer={
            <>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button onClick={() => setModalOpen(false)}>Submit</Button>
            </>
          }
        >
          <p className="text-sm text-ink-muted">
            You answered 18 of 20 questions. 2 are marked for review. Once submitted you cannot change answers.
          </p>
        </Modal>
      </Section>

      <div className="pb-16">
        <PageLoader label="This is the PageLoader" className="min-h-40" />
      </div>
    </div>
  );
};

export default StyleguidePage;
