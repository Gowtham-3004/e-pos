import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../lib/theme';
import { IconButton } from './primitives';
import { T } from './Text';

export function Header({ title, subtitle, right, back, onBack, above }: { title: string; subtitle?: string; right?: ReactNode; back?: boolean; onBack?: () => void; above?: ReactNode }) {
  const t = useTheme();
  const router = useRouter();
  return (
    <View style={{ backgroundColor: t.c.surface.primary, borderBottomWidth: 1, borderBottomColor: t.c.border.default }}>
      {above}
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingLeft: back ? 4 : 16, paddingRight: 8, gap: 4 }}>
        {back ? <IconButton icon="ChevronLeft" label="Back" onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))} /> : null}
        <View style={{ flex: 1, paddingVertical: 8 }}>
          <T v={subtitle ? 'h2' : 'title'} lines={1}>{title}</T>
          {subtitle ? <T v="meta" c="secondary" lines={1}>{subtitle}</T> : null}
        </View>
        {right}
      </View>
    </View>
  );
}

/**
 * Screen scaffold: safe-area top, context header, scrollable body on the app canvas and an
 * optional pinned footer for thumb-reachable primary actions.
 */
export function Screen({
  header, children, footer, scroll = true, padded = true, contentStyle, onRefresh, refreshing, edgesBottom = false,
}: {
  header?: ReactNode; children: ReactNode; footer?: ReactNode; scroll?: boolean; padded?: boolean; contentStyle?: StyleProp<ViewStyle>; onRefresh?: () => void; refreshing?: boolean; edgesBottom?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const pad: ViewStyle = padded ? { padding: 16, paddingBottom: 32 } : {};
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.c.surface.primary }}>
      {header}
      <View style={{ flex: 1, backgroundColor: t.c.surface.app }}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={[pad, { maxWidth: 720, width: '100%', alignSelf: 'center' }, contentStyle]}
            keyboardShouldPersistTaps="handled"
            refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
        )}
      </View>
      {footer ? (
        <View style={{ backgroundColor: t.c.surface.primary, borderTopWidth: 1, borderTopColor: t.c.border.default, paddingHorizontal: 16, paddingTop: 12, paddingBottom: edgesBottom ? Math.max(insets.bottom, 12) : 12 }}>
          <View style={{ maxWidth: 720, width: '100%', alignSelf: 'center' }}>{footer}</View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
