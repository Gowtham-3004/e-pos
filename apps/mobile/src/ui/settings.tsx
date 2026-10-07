import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { CONNECTIVITY } from '@elixir/domain';
import { number } from '@elixir/format';
import { useApp, useNetwork, useSession, useSync } from '../lib/app';
import { simulateIncomingApproval } from '../lib/actions';
import { ROLE_LABEL, ago } from '../lib/fmt';
import { useThemeMode, type ThemeMode } from '../lib/theme';
import { Avatar, Badge, Button, Card, Divider, InlineAlert, KeyValue, Row, SectionTitle, Segmented, StatusBadge } from './primitives';
import { Sheet } from './Sheet';
import { T } from './Text';
import { useToast } from './Toast';

export function ProfileCard({ extra }: { extra?: string }) {
  const s = useSession();
  return (
    <Card>
      <Row gap={14}>
        <Avatar name={s.user.name} color={s.user.avatarColor} size={52} />
        <View style={{ flex: 1 }}>
          <T v="h3">{s.user.name}</T>
          <T v="meta" c="secondary">{`${ROLE_LABEL[s.user.role]} · ${s.tenant.name}`}</T>
          <T v="meta" c="muted">{extra ?? `${s.storeId === 'all' ? 'All stores' : s.store.name} · signed in ${ago(s.signedInAt)}`}</T>
        </View>
      </Row>
      {s.authMode === 'offline' ? <Badge tone="neutral" icon="WifiOff" label="Signed in offline (cached credentials)" style={{ marginTop: 10 }} /> : null}
    </Card>
  );
}

export function SyncCard() {
  const { engine } = useApp();
  const sync = useSync();
  const { online } = useNetwork();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <>
      <SectionTitle title="Sync" />
      <Card>
        <Row style={{ marginBottom: 8 }}>
          <T v="bodyStrong" style={{ flex: 1 }}>This phone</T>
          <StatusBadge meta={CONNECTIVITY[sync.connectivity]} suffix={sync.connectivity === 'syncing' ? String(sync.pending) : undefined} />
        </Row>
        <KeyValue label="Waiting to upload" value={number(sync.pending)} />
        <KeyValue label="Last upload" value={sync.lastSuccessAt ? ago(sync.lastSuccessAt) : sync.pending ? 'Not yet' : 'Nothing to upload'} num={false} />
        <KeyValue label="Cloud" value={sync.cloudReachable ? 'Reachable' : 'Not reachable'} num={false} />
        {sync.quarantined ? (
          <InlineAlert tone="danger" title={`${sync.quarantined} item needs attention`} style={{ marginTop: 8 }}>
            A manager can review it from the Back Office Sync Center. Local work is unaffected.
          </InlineAlert>
        ) : null}
        <Button
          label={online ? 'Sync now' : 'Sync now — offline'}
          icon="RefreshCw"
          variant="secondary"
          loading={busy}
          disabled={!online || !engine}
          style={{ marginTop: 12 }}
          onPress={async () => {
            setBusy(true);
            await engine?.syncNow();
            setBusy(false);
            toast('Sync complete', { body: 'Local changes uploaded, latest data pulled', tone: 'success' });
          }}
        />
        {!online ? <T v="meta" c="muted" style={{ marginTop: 6 }}>Everything you do is saved on this phone and uploads automatically when the connection returns.</T> : null}
      </Card>
    </>
  );
}

export function NetworkCard() {
  const { network } = useNetwork();
  const { engine, device } = useApp();
  const value = network.wan === 'offline' ? 'offline' : network.cloud === 'down' ? 'cloud-down' : 'online';
  const set = async (v: string) => {
    const patch = v === 'online' ? { wan: 'online' as const, cloud: 'up' as const } : v === 'offline' ? { wan: 'offline' as const, cloud: 'up' as const } : { wan: 'online' as const, cloud: 'down' as const };
    if (engine) await engine.setNetwork(patch);
    else await device.setMeta('network', { ...network, ...patch });
  };
  return (
    <>
      <SectionTitle title="Network simulator (demo)" />
      <Card>
        <Segmented
          value={value}
          onChange={(v) => void set(v)}
          options={[
            { value: 'online', label: 'Online', icon: 'Wifi' },
            { value: 'offline', label: 'Offline', icon: 'WifiOff' },
            { value: 'cloud-down', label: 'Cloud down', icon: 'CloudOff' },
          ]}
        />
        <T v="meta" c="muted" style={{ marginTop: 8 }}>Simulates losing internet or an Elixir Cloud outage. Approvals, orders and KOTs keep working locally.</T>
      </Card>
    </>
  );
}

export function AppearanceCard() {
  const { mode, setMode } = useThemeMode();
  return (
    <>
      <SectionTitle title="Appearance" />
      <Card>
        <Segmented<ThemeMode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'light', label: 'Light', icon: 'Sun' },
            { value: 'dark', label: 'Dark', icon: 'Moon' },
            { value: 'system', label: 'System', icon: 'Smartphone' },
          ]}
        />
      </Card>
    </>
  );
}

export function DemoCard() {
  const { cloud, resetDemo } = useApp();
  const s = useSession();
  const toast = useToast();
  const router = useRouter();
  const { online } = useNetwork();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <SectionTitle title="Demo tools" />
      <Card style={{ gap: 10 }}>
        {s.mode === 'owner' && s.can('approvals.act') ? (
          <Button
            label="Simulate counter approval request"
            icon="Inbox"
            variant="secondary"
            onPress={() =>
              void simulateIncomingApproval(cloud, s).then(() =>
                toast('Request raised at counter', { body: online ? 'Arrives with the next sync' : 'Arrives when this phone is back online', tone: 'info' }),
              )
            }
          />
        ) : null}
        <Button label="Reset demo data" icon="RotateCw" variant="danger-outline" onPress={() => setConfirm(true)} />
      </Card>
      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Reset demo data?"
        subtitle="Wipes this phone's local store and the simulated cloud, then reseeds."
        footer={
          <Row gap={10}>
            <Button label="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setConfirm(false)} />
            <Button
              label="Reset"
              variant="danger"
              style={{ flex: 1 }}
              onPress={async () => {
                setConfirm(false);
                await resetDemo();
                router.replace('/sign-in');
              }}
            />
          </Row>
        }
      >
        <T c="secondary">Orders, KOTs, approvals and unsynced changes made on this phone will be lost. This cannot be undone.</T>
      </Sheet>
    </>
  );
}

export function AboutCard() {
  const s = useSession();
  return (
    <>
      <SectionTitle title="About" />
      <Card>
        <KeyValue label="App" value="Elixir POS Mobile" num={false} />
        <KeyValue label="Version" value={Constants.expoConfig?.version ?? '1.4.0'} />
        <KeyValue label="Device" value={s.deviceId.replace(/^d-/, '')} />
        <KeyValue label="Plan" value={s.tenant.plan[0]!.toUpperCase() + s.tenant.plan.slice(1)} num={false} />
      </Card>
    </>
  );
}

export function SignOutButton() {
  const { signOut } = useApp();
  const router = useRouter();
  const sync = useSync();
  return (
    <View style={{ marginTop: 24, gap: 8 }}>
      {sync.pending > 0 ? <T v="meta" c="muted" center>{`${sync.pending} changes still uploading — they stay safe on this phone after sign-out.`}</T> : null}
      <Button
        label="Sign out"
        icon="LogOut"
        variant="danger-outline"
        size="lg"
        onPress={async () => {
          await signOut();
          router.replace('/sign-in');
        }}
      />
    </View>
  );
}

export { Divider };
