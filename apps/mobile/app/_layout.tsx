import '../src/lib/polyfills';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from '../src/lib/app';
import { useKitchenSimulator } from '../src/lib/kitchen';
import { ThemeProvider, useTheme } from '../src/lib/theme';
import { BootScreen, ToastProvider, useToast } from '../src/ui';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ToastProvider>
          <AppProvider boot={(steps, error) => <BootScreen steps={steps} error={error} />}>
            <Shell />
          </AppProvider>
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  const t = useTheme();
  return (
    <>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <RestaurantRuntime />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.c.surface.app }, animation: 'slide_from_right' }}>
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
        <Stack.Screen name="(owner)" options={{ animation: 'fade' }} />
        <Stack.Screen name="(waiter)" options={{ animation: 'fade' }} />
      </Stack>
    </>
  );
}

/** Restaurant sessions: simulated kitchen progress + "ready" notifications. */
function RestaurantRuntime() {
  const { device, session, sessionStartedAt } = useApp();
  const toast = useToast();
  useKitchenSimulator(device, session?.family === 'restaurant' ? session.store.id : undefined, sessionStartedAt, (kot, table) =>
    toast(`${kot} ready`, { body: table ? `Table ${table} · pick up from the pass` : 'Pick up from the pass', haptic: 'success' }),
  );
  return null;
}
