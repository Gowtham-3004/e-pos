import { Redirect, Tabs } from 'expo-router';
import { useLive } from '@elixir/local-store/react';
import { useApp } from '../../src/lib/app';
import { tabIcon, useTabOptions } from '../../src/ui/tabs';

/** Owner / manager experience. Tabs are composed from entitlements — unavailable modules are removed (§10). */
export default function OwnerLayout() {
  const { session, device } = useApp();
  const opts = useTabOptions();
  const pending = useLive(
    device,
    ['approvals'],
    () => (session ? device.where('approvals', (a) => a.tenantId === session.tenant.id && a.status === 'pending' && session.user.storeIds.includes(a.storeId)).length : 0),
    [session?.tenant.id, session?.user.id],
  );
  if (!session) return <Redirect href="/sign-in" />;
  if (session.mode !== 'owner') return <Redirect href="/tables" />;
  const showApprovals = session.can('approvals.act');
  const showStock = session.has('inventory') || session.family === 'restaurant';
  const showDevices = session.can('devices.manage');
  return (
    <Tabs screenOptions={opts}>
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: tabIcon('Home') }} />
      <Tabs.Screen name="approvals" options={{ title: 'Approvals', tabBarIcon: tabIcon('Inbox'), tabBarBadge: pending || undefined, href: showApprovals ? undefined : null }} />
      <Tabs.Screen name="stock" options={{ title: session.family === 'restaurant' ? 'Menu' : 'Stock', tabBarIcon: tabIcon(session.family === 'restaurant' ? 'Utensils' : 'Package'), href: showStock ? undefined : null }} />
      <Tabs.Screen name="devices" options={{ title: 'Devices', tabBarIcon: tabIcon('Monitor'), href: showDevices ? undefined : null }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: tabIcon('More') }} />
    </Tabs>
  );
}
