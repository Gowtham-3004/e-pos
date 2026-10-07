import { useLive } from '@elixir/local-store/react';
import { number } from '@elixir/format';
import { useApp, useSession } from '../../src/lib/app';
import { sectionOf } from '../../src/lib/fmt';
import { Card, Header, KeyValue, OfflinePill, Screen, SectionTitle } from '../../src/ui';
import { AboutCard, AppearanceCard, DemoCard, NetworkCard, ProfileCard, SignOutButton, SyncCard } from '../../src/ui/settings';

export default function Profile() {
  const { device } = useApp();
  const s = useSession();
  const section = device.get('floors', sectionOf(s.user.id));
  const today = new Date().toISOString().slice(0, 10);
  const stats = useLive(
    device,
    ['orders', 'kots'],
    () => {
      const mine = device.where('orders', (o) => o.waiterId === s.user.id && o.storeId === s.store.id);
      return {
        running: mine.filter((o) => !o.closedAt).length,
        kots: device.where('kots', (k) => k.createdBy === s.user.id && k.createdAt.slice(0, 10) === today).length,
      };
    },
    [s.user.id],
  );
  return (
    <Screen header={<Header title="Profile" right={<OfflinePill compact />} />}>
      <ProfileCard extra={`${s.store.name} · ${section ? `${section.name} section` : 'All sections'}`} />
      <SectionTitle title="Today" />
      <Card>
        <KeyValue label="Assigned section" value={section?.name ?? 'All sections'} num={false} />
        <KeyValue label="Running orders" value={number(stats.running)} />
        <KeyValue label="KOTs sent today" value={number(stats.kots)} />
      </Card>
      <SyncCard />
      <NetworkCard />
      <AppearanceCard />
      <DemoCard />
      <AboutCard />
      <SignOutButton />
    </Screen>
  );
}
