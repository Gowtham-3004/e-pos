import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import type { ApprovalRequest } from '@elixir/contracts';
import { useLive, useNow } from '@elixir/local-store/react';
import { elapsedMinutes, money, pct } from '@elixir/format';
import { useApp, useNetwork, useSession } from '../../src/lib/app';
import { decide, simulateIncomingApproval, type VoidApproval } from '../../src/lib/actions';
import { ACTION_LABEL, ago } from '../../src/lib/fmt';
import { useTheme } from '../../src/lib/theme';
import {
  Badge, Button, Card, Chip, Divider, EmptyState, Header, Icon, InlineAlert, OfflinePill, PinDots, PinPad, Row, Screen, Segmented, Sheet, T, TextArea, haptic, usePinKeyboard, useToast,
} from '../../src/ui';

const REJECT_REASONS = ['Exceeds store policy', 'Insufficient justification', 'Customer not eligible', 'Duplicate request'];

export default function Approvals() {
  const t = useTheme();
  const { device, cloud } = useApp();
  const s = useSession();
  const { online } = useNetwork();
  const toast = useToast();
  useNow(30000);
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [approving, setApproving] = useState<ApprovalRequest>();
  const [rejecting, setRejecting] = useState<ApprovalRequest>();

  const list = useLive(device, ['approvals'], () => device.where('approvals', (a) => a.tenantId === s.tenant.id && s.user.storeIds.includes(a.storeId)), [s.tenant.id, s.user.id]);
  const pending = list.filter((a) => a.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const history = list.filter((a) => a.status !== 'pending').sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt));

  const finish = async (a: ApprovalRequest, decision: 'approved' | 'rejected', reason?: string) => {
    await decide(device, s, a as VoidApproval, decision, reason);
    toast(decision === 'approved' ? 'Approved' : 'Rejected', { body: `${a.summary}${online ? '' : ' · will sync when online'}`, tone: decision === 'approved' ? 'success' : 'neutral', haptic: decision === 'approved' ? 'success' : 'warning' });
  };

  return (
    <Screen
      header={<Header title="Approvals" subtitle={`${pending.length} waiting · ${s.storeId === 'all' || s.stores.length === 1 ? (s.stores.length > 1 ? 'all stores' : s.store.name) : 'all your stores'}`} right={<OfflinePill compact />} />}
    >
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'pending', label: 'Pending', count: pending.length },
          { value: 'history', label: 'History', count: history.length },
        ]}
        style={{ marginBottom: 12 }}
      />
      {!online && tab === 'pending' ? (
        <InlineAlert tone="neutral" icon="WifiOff" title="You're offline" style={{ marginBottom: 12 }}>
          Decisions are saved on this phone and reach the counter when you reconnect. New requests arrive once back online.
        </InlineAlert>
      ) : null}

      {tab === 'pending' ? (
        pending.length ? (
          <View style={{ gap: 12 }}>
            {pending.map((a) => (
              <ApprovalCard key={a.id} a={a} onApprove={() => setApproving(a)} onReject={() => setRejecting(a)} />
            ))}
          </View>
        ) : (
          <Card>
            <EmptyState
              icon="CircleCheck"
              title="No approvals waiting"
              body="Discount, return, price override, shift variance and KOT void requests from your counters appear here."
              action={online ? 'Simulate a counter request' : undefined}
              onAction={() => void simulateIncomingApproval(cloud, s).then(() => toast('Request sent from counter', { body: 'Arrives on this phone with the next sync', tone: 'info' }))}
            />
          </Card>
        )
      ) : history.length ? (
        <Card padded={false}>
          {history.map((a, i) => (
            <View key={a.id}>
              {i ? <Divider /> : null}
              <HistoryRow a={a} />
            </View>
          ))}
        </Card>
      ) : (
        <Card>
          <EmptyState quiet title="No decisions yet." />
        </Card>
      )}

      <PinConfirmSheet
        approval={approving}
        onClose={() => setApproving(undefined)}
        onConfirmed={(a) => {
          setApproving(undefined);
          void finish(a, 'approved');
        }}
      />
      <RejectSheet
        approval={rejecting}
        onClose={() => setRejecting(undefined)}
        onReject={(a, reason) => {
          setRejecting(undefined);
          void finish(a, 'rejected', reason);
        }}
      />
    </Screen>
  );

  function ApprovalCard({ a, onApprove, onReject }: { a: ApprovalRequest; onApprove: () => void; onReject: () => void }) {
    const meta = ACTION_LABEL[a.action];
    const who = device.get('users', a.requestedBy);
    const store = device.get('stores', a.storeId);
    const counter = device.get('counters', a.counterId);
    const age = elapsedMinutes(a.createdAt);
    return (
      <Card padded={false}>
        <View style={{ padding: 16, gap: 10 }}>
          <Row>
            <View style={{ width: 32, height: 32, borderRadius: t.radius.md, backgroundColor: t.c.status.warningSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={meta.icon} size={16} color={t.c.status.warning} />
            </View>
            <T v="label" c="secondary" style={{ flex: 1 }}>{meta.label}</T>
            <Badge size="sm" tone={age >= 10 ? 'warning' : 'neutral'} icon="Clock" label={ago(a.createdAt)} />
          </Row>
          <View>
            <T v="h3">{a.summary}</T>
            <T c="secondary" style={{ marginTop: 2 }}>{a.detail}</T>
          </View>
          {a.requestedValue !== undefined || a.amountPaise !== undefined ? (
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              {a.requestedValue !== undefined ? <Fact label="Requested" value={pct(a.requestedValue)} tone="warning" /> : null}
              {a.allowedValue !== undefined ? <Fact label="Allowed" value={pct(a.allowedValue)} /> : null}
              {a.amountPaise !== undefined ? <Fact label={a.action === 'discount' ? 'Bill value' : 'Amount'} value={money(a.amountPaise)} /> : null}
            </Row>
          ) : null}
          <Row gap={6}>
            <Icon name="User" size={13} color={t.c.text.muted} />
            <T v="meta" c="secondary" lines={1} style={{ flex: 1 }}>{[who?.name ?? 'Unknown', store?.name, counter?.code].filter(Boolean).join(' · ')}</T>
          </Row>
        </View>
        <Divider />
        <Row gap={10} style={{ padding: 12 }}>
          <Button label="Reject" variant="danger-outline" icon="X" onPress={onReject} style={{ flex: 1 }} />
          <Button label="Approve" icon="Check" onPress={onApprove} style={{ flex: 1 }} />
        </Row>
      </Card>
    );
  }

  function Fact({ label, value, tone }: { label: string; value: string; tone?: 'warning' }) {
    return (
      <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: t.radius.md, backgroundColor: tone ? t.c.status.warningSoft : t.c.surface.sunken }}>
        <T v="meta" c="secondary">{label}</T>
        <T v="bodyStrong" num style={tone ? { color: t.c.status.warning } : undefined}>{value}</T>
      </View>
    );
  }

  function HistoryRow({ a }: { a: ApprovalRequest }) {
    const by = device.get('users', a.decidedBy);
    const ok = a.status === 'approved';
    return (
      <View style={{ padding: 16, gap: 6 }}>
        <Row>
          <T v="bodyStrong" style={{ flex: 1 }} lines={1}>{a.summary}</T>
          <Badge tone={ok ? 'success' : a.status === 'expired' ? 'neutral' : 'danger'} icon={ok ? 'CircleCheck' : 'CircleX'} label={ok ? 'Approved' : a.status === 'expired' ? 'Expired' : 'Rejected'} size="sm" />
        </Row>
        <T v="meta" c="secondary" lines={2}>{a.detail}</T>
        <T v="meta" c="muted">{`${ACTION_LABEL[a.action].label} · by ${by?.name ?? '—'} · ${ago(a.decidedAt)}${a.reason ? ` · “${a.reason}”` : ''}`}</T>
      </View>
    );
  }
}

/** Biometric-style confirmation (prototype: re-enter PIN). The manager is never "logged in" to the counter (§29). */
function PinConfirmSheet({ approval, onClose, onConfirmed }: { approval?: ApprovalRequest; onClose: () => void; onConfirmed: (a: ApprovalRequest) => void }) {
  const s = useSession();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const digit = useCallback((d: string) => setPin((p) => (p.length < 4 ? p + d : p)), []);
  const del = useCallback(() => setPin((p) => p.slice(0, -1)), []);
  usePinKeyboard(!!approval && !error, digit, del);
  useEffect(() => {
    setPin('');
    setError(false);
  }, [approval?.id]);
  useEffect(() => {
    if (pin.length < 4 || !approval) return;
    if (pin === s.user.pin) {
      haptic('success');
      onConfirmed(approval);
      return;
    }
    setError(true);
    haptic('error');
    const id = setTimeout(() => {
      setPin('');
      setError(false);
    }, 650);
    return () => clearTimeout(id);
  }, [pin]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet open={!!approval} onClose={onClose} title="Confirm approval" subtitle={approval ? `${approval.summary} · approve once` : undefined}>
      <View style={{ gap: 18, paddingTop: 4 }}>
        <Row gap={8} justify="center">
          <Icon name="Fingerprint" size={18} />
          <T v="label" c={error ? 'danger' : 'secondary'}>{error ? 'Incorrect PIN — try again' : `Enter your PIN, ${s.user.name.split(' ')[0]}`}</T>
        </Row>
        <PinDots length={4} value={pin} error={error} />
        <PinPad disabled={error} onDigit={digit} onBackspace={del} />
        <T v="meta" c="muted" center>{`Logged as approved by ${s.user.name} · audit records cashier, approver, action and time.`}</T>
      </View>
    </Sheet>
  );
}

function RejectSheet({ approval, onClose, onReject }: { approval?: ApprovalRequest; onClose: () => void; onReject: (a: ApprovalRequest, reason: string) => void }) {
  const [preset, setPreset] = useState<string>();
  const [note, setNote] = useState('');
  useEffect(() => {
    setPreset(undefined);
    setNote('');
  }, [approval?.id]);
  const reason = [preset, note.trim()].filter(Boolean).join(' — ');
  return (
    <Sheet
      open={!!approval}
      onClose={onClose}
      title="Reject request"
      subtitle={approval?.summary}
      footer={<Button label="Reject request" variant="danger" size="lg" block disabled={!reason} onPress={() => approval && onReject(approval, reason)} />}
    >
      <View style={{ gap: 14 }}>
        <T v="label" c="secondary">Reason (shared with the cashier)</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {REJECT_REASONS.map((r) => (
            <Chip key={r} label={r} selected={preset === r} onPress={() => setPreset(preset === r ? undefined : r)} />
          ))}
        </View>
        <TextArea label="Note (optional)" value={note} onChangeText={setNote} placeholder="Add context for the counter" />
      </View>
    </Sheet>
  );
}
