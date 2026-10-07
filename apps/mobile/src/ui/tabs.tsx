import { Platform, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabNavigationOptions } from 'expo-router/tabs';
import { useTheme } from '../lib/theme';
import { Icon } from './Icon';

/** Shared bottom-tab styling: 64px bar, outline icons, labels always visible. */
export function useTabOptions(): BottomTabNavigationOptions {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return {
    headerShown: false,
    tabBarActiveTintColor: t.dark ? t.c.text.primary : t.c.action.primary,
    tabBarInactiveTintColor: t.c.text.muted,
    tabBarStyle: { backgroundColor: t.c.surface.primary, borderTopColor: t.c.border.default, height: 70 + insets.bottom, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 8) },
    tabBarLabelStyle: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
    tabBarBadgeStyle: { backgroundColor: t.c.status.danger, color: '#fff', fontSize: 11, fontWeight: '700', ...(Platform.OS === 'web' ? { lineHeight: 16 } : {}) },
    sceneStyle: { backgroundColor: t.c.surface.app },
  };
}

export const tabIcon = (name: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Icon name={name} size={22} color={color as string} />;
  };
