import { useState } from 'react';
import type { AuditEvent } from '@elixir/contracts';
import { Button, DataTable, DescriptionList, Drawer, EmptyState, StatusBadge, Timeline, type Column } from '@elixir/ui';
import { dateTime, relative, time } from '@elixir/format';
import { AUDIT_CATEGORY } from '../lib/platform';
import { useLookups } from '../lib/hooks';
import { Mono } from './common';

export function AuditView({ events, mode, showTenant = true, pageSize = 25, emptyHint }: { events: AuditEvent[]; mode: 'table' | 'timeline'; showTenant?: boolean; pageSize?: number; emptyHint?: string }) {
  const lk = useLookups();
  const [open, setOpen] = useState<AuditEvent>();
  const [limit, setLimit] = useState(60);
  const actor = (id: string) => lk.users.get(id)?.name ?? (id.startsWith('u-t-platform') ? 'Platform staff' : id);
  const columns: Column<AuditEvent>[] = [
    { key: 'createdAt', header: 'When', sortable: true, width: 150, render: (a) => <span className="num" title={a.createdAt}>{dateTime(a.createdAt)}</span> },
    { key: 'category', header: 'Category', sortable: true, render: (a) => <StatusBadge meta={AUDIT_CATEGORY[a.category]} /> },
    { key: 'action', header: 'Action', sortable: true, render: (a) => <Mono>{a.action}</Mono> },
    { key: 'summary', header: 'Summary', render: (a) => <span className="pa-clamp" title={a.summary}>{a.summary}{a.reason ? <span className="muted"> · Reason: {a.reason}</span> : null}</span> },
    { key: 'tenant', header: 'Tenant', hidden: !showTenant, sortable: true, sortValue: (a) => lk.tenantName(a.tenantId), render: (a) => lk.tenantName(a.tenantId) },
    { key: 'actor', header: 'Actor', sortable: true, sortValue: (a) => actor(a.actorId), render: (a) => actor(a.actorId) },
  ];
  if (!events.length) return <EmptyState quiet icon="ScrollText" title="No audit events">{emptyHint ?? 'Nothing recorded for these filters.'}</EmptyState>;
  return (
    <>
      {mode === 'table' ? (
        <DataTable columns={columns} rows={events} rowKey={(a) => a.id} onRowClick={setOpen} initialSort={{ key: 'createdAt', dir: 'desc' }} pageSize={pageSize} density="dense" />
      ) : (
        <div className="pa-timeline-wrap">
          <Timeline
            items={events.slice(0, limit).map((a) => ({
              id: a.id,
              time: (
                <span className="num">
                  {new Date(a.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  <br />
                  {time(a.createdAt)}
                </span>
              ),
              title: (
                <button type="button" className="pa-link-btn pa-link-btn--plain" onClick={() => setOpen(a)}>
                  {a.summary}
                </button>
              ),
              meta: (
                <span className="ex-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  <StatusBadge meta={AUDIT_CATEGORY[a.category]} />
                  <Mono>{a.action}</Mono>
                  <span>
                    {actor(a.actorId)}
                    {showTenant ? ` · ${lk.tenantName(a.tenantId)}` : ''} · {relative(a.createdAt)}
                  </span>
                </span>
              ),
              tone: a.category === 'security' ? 'danger' : a.category === 'technical' ? undefined : 'info',
            }))}
          />
          {events.length > limit ? (
            <Button variant="ghost" onClick={() => setLimit((l) => l + 60)}>
              Show more ({events.length - limit} older)
            </Button>
          ) : null}
        </div>
      )}
      <Drawer open={!!open} onClose={() => setOpen(undefined)} title="Audit event" description="Immutable record — audit events cannot be edited or deleted">
        {open ? (
          <div className="ex-stack">
            <DescriptionList
              items={[
                ['Event ID', <Mono>{open.id}</Mono>],
                ['When', dateTime(open.createdAt)],
                ['Category', <StatusBadge meta={AUDIT_CATEGORY[open.category]} />],
                ['Action', <Mono>{open.action}</Mono>],
                ['Summary', open.summary],
                ['Reason', open.reason],
                ['Actor', actor(open.actorId)],
                ['Approved by', open.approvedBy ? actor(open.approvedBy) : undefined],
                ['Tenant', lk.tenantName(open.tenantId)],
                ['Store', open.storeId ? lk.storeName(open.storeId) : undefined],
                ['Device', open.deviceId ? lk.devices.get(open.deviceId)?.code ?? open.deviceId : undefined],
                ['Entity', <Mono>{`${open.entity} · ${open.entityId}`}</Mono>],
                ['Document', open.documentNo],
              ]}
            />
            {open.before !== undefined || open.after !== undefined ? (
              <div className="pa-json-pair">
                {open.before !== undefined ? (
                  <div>
                    <div className="ex-label">Before</div>
                    <pre className="pa-pre">{JSON.stringify(open.before, null, 2)}</pre>
                  </div>
                ) : null}
                {open.after !== undefined ? (
                  <div>
                    <div className="ex-label">After</div>
                    <pre className="pa-pre">{JSON.stringify(open.after, null, 2)}</pre>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
