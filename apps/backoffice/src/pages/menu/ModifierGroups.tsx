import { useState } from 'react';
import type { ModifierGroup } from '@elixir/contracts';
import { uid } from '@elixir/domain';
import { Badge, Button, Card, CardHeader, Checkbox, IconButton, InlineAlert, TextField, useToast } from '@elixir/ui';
import { useLive } from '@elixir/local-store/react';
import { money, paiseToRupeesInput, rupeesToPaise } from '@elixir/format';
import { PageFrame } from '../../components/common';
import { useCloud } from '../../lib/data';
import { saveMaster } from '../../lib/ops';
import { useSession } from '../../lib/session';

export function ModifierGroupsPage() {
  const s = useSession();
  const cloud = useCloud();
  const [adding, setAdding] = useState(false);
  const data = useLive(cloud, ['modifierGroups', 'menuItems'], () => ({
    groups: cloud.all('modifierGroups'),
    usage: (id: string) => cloud.where('menuItems', (m) => m.tenantId === s.tenant.id && m.modifierGroupIds.includes(id)).length,
  }), [s.tenant.id]);
  return (
    <PageFrame
      title="Modifier groups"
      description="Choices offered when ordering an item — size, spice level, add-ons. Required groups must be chosen before sending KOT."
      crumbs={[{ label: 'Menu', to: '/menu' }, { label: 'Modifier groups' }]}
      actions={s.can('catalog.edit') ? <Button variant="primary" icon="Plus" onClick={() => setAdding(true)}>New group</Button> : undefined}
    >
      <div className="bo-grid-2">
        {adding ? <GroupEditor onDone={() => setAdding(false)} /> : null}
        {data.groups.map((g) => <GroupEditor key={g.id} group={g} used={data.usage(g.id)} />)}
      </div>
    </PageFrame>
  );
}

function GroupEditor({ group, used, onDone }: { group?: ModifierGroup; used?: number; onDone?: () => void }) {
  const s = useSession();
  const cloud = useCloud();
  const toast = useToast();
  const [g, setG] = useState<ModifierGroup>(() => group ?? { id: `mg-${uid().slice(-8)}`, name: '', required: false, min: 0, max: 1, options: [{ id: `mo-${uid().slice(-8)}`, name: '', pricePaise: 0 }] });
  const [prices, setPrices] = useState<string[]>(() => g.options.map((o) => paiseToRupeesInput(o.pricePaise)));
  const [error, setError] = useState<string>();
  const dirty = JSON.stringify({ ...g, options: g.options.map((o, i) => ({ ...o, pricePaise: rupeesToPaise(prices[i] ?? '0') })) }) !== JSON.stringify(group);
  const canEdit = s.can('catalog.edit');

  const save = async () => {
    const opts = g.options.map((o, i) => ({ ...o, name: o.name.trim(), pricePaise: rupeesToPaise(prices[i] ?? '0') })).filter((o) => o.name);
    if (!g.name.trim()) return setError('Give the group a name, e.g. “Spice level”.');
    if (!opts.length) return setError('Add at least one option.');
    const min = g.required ? Math.max(1, g.min) : g.min;
    if (g.max < min) return setError(`Maximum choices (${g.max}) cannot be less than minimum (${min}).`);
    if (g.max > opts.length) return setError(`Maximum choices (${g.max}) cannot exceed the number of options (${opts.length}).`);
    setError(undefined);
    const next = { ...g, name: g.name.trim(), min, options: opts };
    await saveMaster(cloud, { tenantId: s.tenant.id, collection: 'modifierGroups', entity: next, summary: `Modifier group ${next.name} ${group ? 'updated' : 'created'}`, actorId: s.user.id, action: group ? 'modifier.updated' : 'modifier.created', entityName: 'modifier_group', before: group });
    toast.success('Modifier group saved');
    onDone?.();
  };

  return (
    <Card>
      <CardHeader title={group ? group.name : 'New modifier group'} subtitle={group ? `Used by ${used ?? 0} menu item(s)` : undefined} actions={<Badge tone={g.required ? 'warning' : 'neutral'}>{g.required ? 'Required' : 'Optional'} · {g.max === 1 ? 'Choose one' : `Up to ${g.max}`}</Badge>} />
      <div style={{ padding: 16 }} className="ex-stack">
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }} className="ex-stack">
          <div className="bo-form-grid bo-form-grid--3" style={{ alignItems: 'end' }}>
            <TextField label="Group name" value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} />
            <TextField label="Min choices" inputMode="numeric" value={String(g.min)} onChange={(e) => setG({ ...g, min: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
            <TextField label="Max choices" inputMode="numeric" value={String(g.max)} onChange={(e) => setG({ ...g, max: Number(e.target.value.replace(/\D/g, '')) || 1 })} />
          </div>
          <Checkbox label="Required — order can't be sent without a choice" checked={g.required} onChange={(e) => setG({ ...g, required: e.target.checked, min: e.target.checked ? Math.max(1, g.min) : 0 })} />
          <div className="ex-label">Options</div>
          {g.options.map((o, i) => (
            <div key={o.id} className="ex-row" style={{ alignItems: 'center' }}>
              <div style={{ flex: 2 }}><TextField aria-label="Option name" placeholder="Option name" value={o.name} onChange={(e) => setG({ ...g, options: g.options.map((x) => (x.id === o.id ? { ...x, name: e.target.value } : x)) })} /></div>
              <div style={{ flex: 1 }}><TextField aria-label="Extra price" prefix="+₹" inputMode="decimal" value={prices[i] ?? ''} onChange={(e) => setPrices(prices.map((p, j) => (j === i ? e.target.value : p)))} className="num" /></div>
              <IconButton icon="Trash2" label={`Remove ${o.name || 'option'}`} disabled={g.options.length <= 1} onClick={() => { setG({ ...g, options: g.options.filter((x) => x.id !== o.id) }); setPrices(prices.filter((_, j) => j !== i)); }} />
            </div>
          ))}
          <div><Button size="sm" variant="ghost" icon="Plus" onClick={() => { setG({ ...g, options: [...g.options, { id: `mo-${uid().slice(-8)}`, name: '', pricePaise: 0 }] }); setPrices([...prices, '0.00']); }}>Add option</Button></div>
        </fieldset>
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        <div className="muted" style={{ fontSize: 12 }}>Preview: {g.options.filter((o) => o.name).map((o, i) => `${o.name}${rupeesToPaise(prices[i] ?? '0') ? ` (+${money(rupeesToPaise(prices[i] ?? '0'))})` : ''}`).join(' · ') || '—'}</div>
        {canEdit ? (
          <div className="ex-row" style={{ justifyContent: 'flex-end' }}>
            {onDone ? <Button onClick={onDone}>Cancel</Button> : null}
            <Button variant="primary" icon="Save" disabled={!dirty} onClick={() => void save()}>Save group</Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
