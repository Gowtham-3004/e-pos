import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../lib/theme';
import { IconButton } from './primitives';
import { T } from './Text';

/**
 * Bottom sheet (Design System §62: modifiers, filters, details, small decisions).
 * The footer is pinned to the bottom so the primary action stays thumb-reachable.
 */
export function Sheet({ open, onClose, title, subtitle, children, footer, scroll = true, maxHeight = '88%' }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode; scroll?: boolean; maxHeight?: `${number}%` | number;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable accessibilityLabel="Close" onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(11,20,36,0.45)' }} />
        <View
          accessibilityViewIsModal
          style={{ backgroundColor: t.c.surface.elevated, borderTopLeftRadius: t.radius.xl, borderTopRightRadius: t.radius.xl, maxHeight, width: '100%', maxWidth: 640, alignSelf: 'center' }}
        >
          <View style={{ alignItems: 'center', paddingTop: 8 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: t.c.border.strong }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, gap: 8 }}>
            <View style={{ flex: 1, paddingTop: 8 }}>
              <T v="h2">{title}</T>
              {subtitle ? <T v="meta" c="secondary" style={{ marginTop: 2 }}>{subtitle}</T> : null}
            </View>
            <IconButton icon="X" label="Close" onPress={onClose} />
          </View>
          {scroll ? (
            <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: footer ? 12 : insets.bottom + 16 }} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          ) : (
            <View style={{ paddingHorizontal: 16, paddingBottom: footer ? 12 : insets.bottom + 16 }}>{children}</View>
          )}
          {footer ? (
            <View style={{ borderTopWidth: 1, borderTopColor: t.c.border.default, paddingHorizontal: 16, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 12) + 4 }}>{footer}</View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
