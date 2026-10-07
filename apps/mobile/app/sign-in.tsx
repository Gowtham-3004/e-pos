import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import type { Tenant, User } from '@elixir/contracts';
import { PLANS, VERTICAL_LABEL, familyOf, resolveCapabilities } from '@elixir/domain';
import { dateLong } from '@elixir/format';
import { DEMO_LOGINS } from '@elixir/mock-data';
import { MOBILE_ROLES, useApp, useNetwork } from '../src/lib/app';
import { ROLE_LABEL } from '../src/lib/fmt';
import { useTheme } from '../src/lib/theme';
import { Avatar, Badge, Card, ElixirMark, Icon, IconButton, InlineAlert, OfflinePill, PinDots, PinPad, Row, Segmented, T, haptic, usePinKeyboard } from '../src/ui';

type Step = 'business' | 'user' | 'pin';

export default function SignIn() {
  const t = useTheme();
  const router = useRouter();
  const { device, signIn } = useApp();
  const { online, setWan } = useNetwork();
  const { width } = useWindowDimensions();
  const tileW = (Math.min(width, 560) - 32 - 12) / 2;
  const [step, setStep] = useState<Step>('business');
  const [tenant, setTenant] = useState<Tenant>();
  const [user, setUser] = useState<User>();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const tenants = useMemo(() => DEMO_LOGINS.map((l) => ({ login: l, tenant: device.get('tenants', l.tenantId)! })), [device]);
  const users = useMemo(
    () => (tenant ? device.where('users', (u) => u.tenantId === tenant.id && u.active && MOBILE_ROLES.includes(u.role)).sort((a, b) => MOBILE_ROLES.indexOf(a.role) - MOBILE_ROLES.indexOf(b.role)) : []),
    [device, tenant],
  );
  const offlineValid = !user?.offlineAuthValidUntil || new Date(user.offlineAuthValidUntil).getTime() > Date.now();

  useEffect(() => {
    if (pin.length < 4 || !user || !tenant) return;
    if (pin !== user.pin) {
      setError(true);
      haptic('error');
      const id = setTimeout(() => {
        setPin('');
        setError(false);
      }, 650);
      return () => clearTimeout(id);
    }
    setBusy(true);
    haptic('success');
    void signIn(tenant.id, user.id).then(() => router.replace('/'));
  }, [pin, user, tenant, signIn, router]);

  const digit = useCallback((d: string) => setPin((p) => (p.length < 4 ? p + d : p)), []);
  const del = useCallback(() => setPin((p) => p.slice(0, -1)), []);
  usePinKeyboard(step === 'pin' && !busy && !error, digit, del);

  const back = () => {
    setPin('');
    setError(false);
    setStep(step === 'pin' ? 'user' : 'business');
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: t.c.surface.app }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: step === 'business' ? 16 : 4, paddingRight: 16, minHeight: 56, gap: 8 }}>
        {step !== 'business' ? <IconButton icon="ChevronLeft" label="Back" onPress={back} /> : <ElixirMark size={32} />}
        <View style={{ flex: 1 }}>
          <T v="h3">Elixir POS</T>
          <T v="meta" c="secondary">Owner · Manager · Waiter</T>
        </View>
        <OfflinePill compact onPress={() => void setWan(online ? 'offline' : 'online')} />
      </View>

      {step === 'business' ? (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
          <View style={{ marginTop: 8, marginBottom: 4 }}>
            <T v="title">Choose your business</T>
            <T c="secondary" style={{ marginTop: 4 }}>Sign in on this phone to run approvals, stock checks or table service.</T>
          </View>
          {tenants.map(({ login, tenant: tn }) => {
            const caps = resolveCapabilities(tn);
            const entitled = caps.includes('mobile-app');
            const restaurant = familyOf(tn.vertical) === 'restaurant';
            const stores = device.where('stores', (s) => s.tenantId === tn.id).length;
            return (
              <Card
                key={tn.id}
                padded={false}
                accessibilityLabel={`${tn.name}, ${login.label}`}
                onPress={() => {
                  setTenant(tn);
                  setStep('user');
                }}
              >
                <Row gap={12} style={{ padding: 14 }}>
                  <View style={{ width: 44, height: 44, borderRadius: t.radius.md, backgroundColor: t.c.surface.sunken, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={restaurant ? 'Utensils' : 'Store'} size={22} color={t.c.text.primary} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <T v="h3">{tn.name}</T>
                    <T v="meta" c="secondary">{`${VERTICAL_LABEL[tn.vertical]} · ${PLANS.find((p) => p.code === tn.plan)?.name ?? tn.plan} · ${stores} store${stores > 1 ? 's' : ''}`}</T>
                    {!entitled ? <Badge size="sm" tone="warning" icon="Lock" label="Mobile app not in plan" style={{ marginTop: 4 }} /> : null}
                  </View>
                  <Icon name="ChevronRight" size={20} color={t.c.text.muted} />
                </Row>
              </Card>
            );
          })}
          <View style={{ marginTop: 12, gap: 8 }}>
            <T v="overline" c="muted">Network simulator</T>
            <Segmented
              value={online ? 'online' : 'offline'}
              onChange={(v) => void setWan(v)}
              options={[
                { value: 'online', label: 'Online', icon: 'Wifi' },
                { value: 'offline', label: 'Offline', icon: 'WifiOff' },
              ]}
            />
            <T v="meta" c="muted">Offline sign-in uses credentials cached on this phone. Everything you do is saved locally and syncs on reconnect.</T>
          </View>
        </ScrollView>
      ) : null}

      {step === 'user' && tenant ? (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
          <View style={{ marginTop: 8 }}>
            <T v="title">{tenant.name}</T>
            <T c="secondary" style={{ marginTop: 4 }}>Who is signing in?</T>
          </View>
          {!resolveCapabilities(tenant).includes('mobile-app') ? (
            <InlineAlert tone="warning" icon="Lock" title="Mobile app is not part of the Starter plan">
              Upgrade to Pro or Business to use approvals, live stock and waiter ordering on phones. Billing continues on the POS terminal.
            </InlineAlert>
          ) : (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                {users.map((u) => (
                  <Pressable
                    key={u.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${u.name}, ${ROLE_LABEL[u.role]}`}
                    onPress={() => {
                      setUser(u);
                      setPin('');
                      setStep('pin');
                    }}
                    style={({ pressed }) => ({
                      width: tileW, minHeight: 120, padding: 14, gap: 10, borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.c.border.default,
                      backgroundColor: pressed ? t.c.surface.selected : t.c.surface.primary, justifyContent: 'center',
                    })}
                  >
                    <Avatar name={u.name} color={u.avatarColor} size={44} />
                    <View>
                      <T v="bodyStrong" lines={1}>{u.name}</T>
                      <T v="meta" c="secondary">{ROLE_LABEL[u.role]}</T>
                    </View>
                  </Pressable>
                ))}
              </View>
              <T v="meta" c="muted" style={{ marginTop: 4 }}>Cashiers and kitchen staff sign in on the POS terminal or kitchen display.</T>
            </>
          )}
        </ScrollView>
      ) : null}

      {step === 'pin' && user && tenant ? (
        <View style={{ flex: 1, padding: 16, justifyContent: 'space-between', maxWidth: 480, width: '100%', alignSelf: 'center' }}>
          <View style={{ alignItems: 'center', gap: 8, marginTop: 8 }}>
            <Avatar name={user.name} color={user.avatarColor} size={60} />
            <T v="h2">{user.name}</T>
            <T c="secondary">{`${ROLE_LABEL[user.role]} · ${tenant.name}`}</T>
            {!online ? (
              <InlineAlert
                tone={offlineValid ? 'info' : 'danger'}
                icon="WifiOff"
                title={offlineValid ? 'Offline sign-in' : 'Offline sign-in expired'}
                style={{ marginTop: 8, alignSelf: 'stretch' }}
              >
                {offlineValid
                  ? `Using credentials cached on this phone · valid until ${dateLong(user.offlineAuthValidUntil!)}`
                  : 'Connect to the internet once to refresh your offline credentials.'}
              </InlineAlert>
            ) : null}
          </View>
          <View style={{ gap: 20, paddingBottom: 8 }}>
            <View style={{ gap: 10, alignItems: 'center' }}>
              <T v="label" c={error ? 'danger' : 'secondary'}>{error ? 'Incorrect PIN — try again' : busy ? 'Signing in…' : 'Enter your 4-digit PIN'}</T>
              <PinDots length={4} value={pin} error={error} />
            </View>
            <PinPad disabled={busy || error || (!online && !offlineValid)} onDigit={digit} onBackspace={del} />
            <T v="meta" c="muted" center>{`Demo PIN ${user.pin}`}</T>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
