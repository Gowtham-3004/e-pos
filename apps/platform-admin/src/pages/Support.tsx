import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Avatar, Badge, Button, Card, CardBody, CardHeader, DataTable, DescriptionList, Drawer, EmptyState, FilterBar, Modal, Page, PageHeader, SearchInput, Segmented, Select, StatusBadge, TextField, Textarea, useToast, type Column } from '@elixir/ui';
import { DEVICE_STATUS, SUBSCRIPTION_STATUS, VERTICAL_LABEL } from '@elixir/domain';
import type { SupportTicket } from '@elixir/contracts';
import { useLive, useNow } from '@elixir/local-store/react';
import { dateTime, relative } from '@elixir/format';
import { useActor, useCloud, useLookups } from '../lib/hooks';
import { TICKET_PRIORITY, TICKET_STATUS, planName } from '../lib/platform';
import { addTicketNote, createTicket, updateTicket, type TicketWithNotes } from '../lib/mutations';
import { GuardedButton } from '../components/common';

const STAFF = ['Nisha Varma', 'Rahul Dev'];
const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 } as const;

export function Support() {
  const cloud = useCloud();
  const nav = useNavigate();
  const { id } = useParams();
  const lk = useLookups();
  const now = useNow(30000);
  const [sp, setSp] = useSearchParams();
  const [view, setView] = useState<'active' | 'all'>('active');
  const [create, setCreate] = useState(false);
  const q = sp.get('q') ?? '', tenant = sp.get('tenant') ?? '', priority = sp.get('priority') ?? '';
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };
  const all = useLive(cloud, ['tickets'], () => cloud.all('tickets') as TicketWithNotes[]);
  const rows = all.filter((t) => (view === 'all' || t.status !== 'resolved') && (!tenant || t.tenantId === tenant) && (!priority || t.priority === priority) && (!q || `${t.id} ${t.subject} ${lk.tenantName(t.tenantId)}`.toLowerCase().includes(q.toLowerCase())));
  const columns: Column<TicketWithNotes>[] = [
    { key: 'id', header: 'Ticket', sortable: true, render: (t) => <span className="pa-mono">{t.id.toUpperCase()}</span> },
    { key: 'priority', header: 'Priority', sortable: true, sortValue: (t) => PRIORITY_RANK[t.priority], render: (t) => <StatusBadge meta={TICKET_PRIORITY[t.priority]} /> },
    { key: 'subject', header: 'Subject', render: (t) => <span><b>{t.subject}</b>{t.notes?.length ? <span className="muted"> · {t.notes.length} note{t.notes.length > 1 ? 's' : ''}</span> : null}</span> },
    { key: 'tenant', header: 'Tenant', sortable: true, sortValue: (t) => lk.tenantName(t.tenantId), render: (t) => lk.tenantName(t.tenantId) },
    { key: 'status', header: 'Status', sortable: true, render: (t) => <StatusBadge meta={TICKET_STATUS[t.status]} /> },
    { key: 'assignee', header: 'Assignee', sortable: true, render: (t) => t.assignee ?? <span className="muted">Unassigned</span> },
    { key: 'createdAt', header: 'Opened', align: 'right', sortable: true, render: (t) => <span className="num" title={dateTime(t.createdAt)}>{relative(t.createdAt, now)}</span> },
  ];
  const active = [
    tenant && { key: 'tenant', label: `Tenant: ${lk.tenantName(tenant)}`, onRemove: () => set('tenant', '') },
    priority && { key: 'priority', label: `Priority: ${TICKET_PRIORITY[priority as SupportTicket['priority']].label}`, onRemove: () => set('priority', '') },
  ].filter(Boolean) as Array<{ key: string; label: string; onRemove: () => void }>;
  return (
    <Page>
      <PageHeader title="Support" description="Tenant tickets with device, sync and subscription context" actions={<GuardedButton action="ticket.manage" variant="primary" icon="Plus" onClick={() => setCreate(true)}>New ticket</GuardedButton>} />
      <FilterBar active={active} onClearAll={() => setSp({}, { replace: true })}>
        <Segmented value={view} onChange={setView} label="View" items={[{ key: 'active', label: 'Active', count: all.filter((t) => t.status !== 'resolved').length }, { key: 'all', label: 'All', count: all.length }]} />
        <SearchInput placeholder="Search tickets" value={q} onChange={(e) => set('q', e.target.value)} onClear={() => set('q', '')} wrapClassName="pa-filter-search" aria-label="Search tickets" />
        <Select aria-label="Tenant" value={tenant} onChange={(e) => set('tenant', e.target.value)} placeholder="All tenants" options={[...lk.tenants.values()].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ value: t.id, label: t.name }))} />
        <Select aria-label="Priority" value={priority} onChange={(e) => set('priority', e.target.value)} placeholder="All priorities" options={Object.entries(TICKET_PRIORITY).map(([value, m]) => ({ value, label: m.label }))} />
      </FilterBar>
      <Card>
        <DataTable columns={columns} rows={rows} rowKey={(t) => t.id} onRowClick={(t) => nav(`/support/${t.id}${sp.toString() ? `?${sp}` : ''}`)} selectedKey={id} initialSort={{ key: 'priority', dir: 'asc' }} empty={<EmptyState icon="LifeBuoy" title="No tickets here" actions={<Button onClick={() => setCreate(true)} icon="Plus">New ticket</Button>}>Nothing open for these filters.</EmptyState>} />
      </Card>
      <TicketDrawer id={id} onClose={() => nav(`/support${sp.toString() ? `?${sp}` : ''}`)} />
      <CreateTicket open={create} onClose={() => setCreate(false)} defaultTenant={tenant} />
    </Page>
  );
}

function TicketDrawer({ id, onClose }: { id?: string; onClose: () => void }) {
  const cloud = useCloud();
  const actor = useActor();
  const toast = useToast();
  const nav = useNavigate();
  const lk = useLookups();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const data = useLive(cloud, ['tickets', 'devices', 'syncConflicts'], () => {
    const t = id ? (cloud.get('tickets', id) as TicketWithNotes | undefined) : undefined;
    if (!t) return undefined;
    const devices = cloud.where('devices', (d) => d.tenantId === t.tenantId);
    return {
      t,
      devices: devices.filter((d) => d.status !== 'active' && d.status !== 'revoked').slice(0, 5),
      deviceCount: devices.length,
      pending: devices.reduce((s, d) => s + d.pendingSync, 0),
      conflicts: cloud.where('syncConflicts', (c) => c.tenantId === t.tenantId && c.state === 'open').length,
    };
  }, [id]);
  if (!id) return null;
  if (!data) return <Drawer open onClose={onClose} title="Ticket not found"><EmptyState icon="SearchX" title="This ticket no longer exists" /></Drawer>;
  const { t } = data;
  const tenant = lk.tenants.get(t.tenantId);
  const patch = async (p: Partial<Pick<SupportTicket, 'status' | 'assignee' | 'priority'>>) => {
    await updateTicket(cloud, actor, t, p);
    toast.success('Ticket updated');
  };
  return (
    <Drawer
      open
      onClose={onClose}
      size="lg"
      title={<span className="ex-row" style={{ gap: 10 }}><span className="pa-mono">{t.id.toUpperCase()}</span><StatusBadge meta={TICKET_PRIORITY[t.priority]} /><StatusBadge meta={TICKET_STATUS[t.status]} /></span>}
      description={t.subject}
    >
      <div className="ex-stack" style={{ gap: 'var(--space-lg)' }}>
        <div className="pa-form-grid">
          <Select label="Status" value={t.status} onChange={(e) => patch({ status: e.target.value as SupportTicket['status'] })} options={Object.entries(TICKET_STATUS).map(([value, m]) => ({ value, label: m.label }))} />
          <Select label="Assignee" value={t.assignee ?? ''} onChange={(e) => patch({ assignee: e.target.value || undefined })} placeholder="Unassigned" options={STAFF.map((s) => ({ value: s, label: s }))} />
          <Select label="Priority" value={t.priority} onChange={(e) => patch({ priority: e.target.value as SupportTicket['priority'] })} options={Object.entries(TICKET_PRIORITY).map(([value, m]) => ({ value, label: m.label }))} />
          <div className="ex-field"><span className="ex-label">Opened</span><span className="num">{dateTime(t.createdAt)}</span></div>
        </div>
        {tenant ? (
          <Card flat>
            <CardHeader title={tenant.name} subtitle={`${VERTICAL_LABEL[tenant.vertical]} · ${planName(tenant.plan)} · ${tenant.contactName} ${tenant.contactPhone}`} icon="Building2" actions={<StatusBadge meta={SUBSCRIPTION_STATUS[tenant.subscriptionStatus]} />} />
            <CardBody className="ex-stack">
              <div className="pa-mini-stats">
                <div><span className="muted">Devices</span><b className="num">{data.deviceCount}</b></div>
                <div><span className="muted">Pending sync</span><b className="num">{data.pending}</b></div>
                <div><span className="muted">Open conflicts</span><b className={`num${data.conflicts ? ' pa-tone-danger' : ''}`}>{data.conflicts}</b></div>
                <div><span className="muted">Config</span><b className="num">v{tenant.configVersion}</b></div>
              </div>
              {data.devices.length ? (
                <div className="ex-stack" style={{ gap: 4 }}>
                  <span className="ex-label">Devices needing attention</span>
                  {data.devices.map((d) => (
                    <button key={d.id} type="button" className="pa-ctx-row" onClick={() => nav(`/devices/${d.id}`)}>
                      <span className="pa-mono">{d.code}</span>
                      <span className="muted ex-truncate">{d.name}</span>
                      <StatusBadge meta={DEVICE_STATUS[d.status]} />
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="ex-row" style={{ flexWrap: 'wrap' }}>
                <Button size="sm" icon="MonitorSmartphone" onClick={() => nav(`/devices?tenant=${tenant.id}`)}>Devices</Button>
                <Button size="sm" icon="RefreshCw" onClick={() => nav(`/tenants/${tenant.id}?tab=sync`)}>Sync health</Button>
                <Button size="sm" icon="Layers" onClick={() => nav(`/tenants/${tenant.id}?tab=subscription`)}>Subscription</Button>
                <Button size="sm" icon="ScrollText" onClick={() => nav(`/tenants/${tenant.id}?tab=audit`)}>Audit</Button>
              </div>
            </CardBody>
          </Card>
        ) : null}
        <section className="ex-stack">
          <h3 className="pa-h3">Internal notes <Badge>Not visible to tenant</Badge></h3>
          {t.notes?.length ? (
            <ul className="pa-notes">
              {t.notes.map((n) => (
                <li key={n.id}>
                  <Avatar name={n.authorName} />
                  <div>
                    <div><b>{n.authorName}</b> <span className="muted num">· {dateTime(n.createdAt)}</span></div>
                    <p>{n.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="muted">No notes yet.</p>}
          <Textarea label="Add note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Findings, next steps, who you spoke with…" />
          <div className="ex-row">
            <div className="ex-spacer" />
            <GuardedButton action="ticket.manage" variant="primary" icon="MessageSquarePlus" loading={busy} disabled={note.trim().length < 2} onClick={async () => {
              setBusy(true);
              try { await addTicketNote(cloud, actor, t, note.trim()); setNote(''); toast.success('Note added'); } finally { setBusy(false); }
            }}>Add note</GuardedButton>
          </div>
        </section>
        <DescriptionList items={[['Ticket ID', <span className="pa-mono">{t.id}</span>], ['Tenant ID', <span className="pa-mono">{t.tenantId}</span>]]} />
      </div>
    </Drawer>
  );
}

function CreateTicket({ open, onClose, defaultTenant }: { open: boolean; onClose: () => void; defaultTenant?: string }) {
  const cloud = useCloud();
  const actor = useActor();
  const toast = useToast();
  const nav = useNavigate();
  const lk = useLookups();
  const [tenantId, setTenantId] = useState(defaultTenant ?? '');
  const [subject, setSubject] = useState('');
  const [priority, setPriority] = useState<SupportTicket['priority']>('medium');
  const [assignee, setAssignee] = useState(actor.name);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const errs = { tenant: !tenantId ? 'Choose the tenant this ticket is about.' : undefined, subject: subject.trim().length < 6 ? 'Describe the issue in at least 6 characters.' : undefined };
  const submit = async () => {
    setTried(true);
    if (errs.tenant || errs.subject) return;
    setBusy(true);
    try {
      const t = await createTicket(cloud, actor, { tenantId, subject: subject.trim(), priority, assignee: assignee || undefined });
      toast.success(`Ticket ${t.id.toUpperCase()} created`);
      setSubject(''); setTried(false);
      onClose();
      nav(`/support/${t.id}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="New support ticket" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Create ticket</Button></>}>
      <div className="ex-stack">
        <Select label="Tenant" required value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="Choose tenant" error={tried ? errs.tenant : undefined} options={[...lk.tenants.values()].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ value: t.id, label: t.name }))} />
        <TextField label="Subject" required value={subject} onChange={(e) => setSubject(e.target.value)} error={tried ? errs.subject : undefined} placeholder="e.g. Counter C02 cannot print receipts" />
        <div className="pa-form-grid">
          <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as SupportTicket['priority'])} options={Object.entries(TICKET_PRIORITY).map(([value, m]) => ({ value, label: m.label }))} />
          <Select label="Assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Unassigned" options={STAFF.map((s) => ({ value: s, label: s }))} />
        </div>
      </div>
    </Modal>
  );
}
