import { Header, OfflinePill, Screen } from '../../src/ui';
import { AboutCard, AppearanceCard, DemoCard, NetworkCard, ProfileCard, SignOutButton, SyncCard } from '../../src/ui/settings';

export default function More() {
  return (
    <Screen header={<Header title="More" right={<OfflinePill compact />} />}>
      <ProfileCard />
      <SyncCard />
      <NetworkCard />
      <AppearanceCard />
      <DemoCard />
      <AboutCard />
      <SignOutButton />
    </Screen>
  );
}
