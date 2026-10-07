import { Redirect, Tabs } from 'expo-router';
import { useLive } from '@elixir/local-store/react';
import { useApp } from '../../src/lib/app';
import { tabIcon, useTabOptions } from '../../src/ui/tabs';

/** Waiter experience (§19): Tables | Orders | Calls | Profile. */
export default function WaiterLayout() {
  const { session, device } = useApp();
  const opts = useTabOptions();
  const counts = useLive(
    device,
    ['waiterCalls', 'orders'],
    () => {
      if (!session) return { calls: 0, unsent: 0 };
      const calls = device.where('waiterCalls', (c) => c.storeId === session.store.id && c.status === 'open').length;
      const unsent = device.where('orders', (o) => o.storeId === session.store.id && o.waiterId === session.user.id && !o.closedAt && o.lines.some((l) => l.state === 'unsent')).length;
      return { calls, unsent };
    },
    [session?.store.id, session?.user.id],
  );
  if (!session) return <Redirect href="/sign-in" />;
  if (session.mode !== 'waiter') return <Redirect href="/home" />;
  return (
    <Tabs screenOptions={opts}>
      <Tabs.Screen name="tables" options={{ title: 'Tables', tabBarIcon: tabIcon('Grid') }} />
      <Tabs.Screen name="orders" options={{ title: 'Orders', tabBarIcon: tabIcon('ClipboardList'), tabBarBadge: counts.unsent || undefined }} />
      <Tabs.Screen name="calls" options={{ title: 'Calls', tabBarIcon: tabIcon('Bell'), tabBarBadge: counts.calls || undefined }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: tabIcon('User') }} />
    </Tabs>
  );
}
