// The one standard popup for messages after an action: red for a problem, indigo for done.
// Every <ErrorText> shows its message here too, so a problem is seen even when the inline text is off screen
// (a long form with the error at the bottom). Call showToast() from anywhere; <ToastHost /> sits once in the root layout.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CloseIcon } from '@/components/Icons';
import { Text } from '@/components/Text';
import { colors, fonts, radius, shadows } from '@/theme/tokens';

export type ToastKind = 'error' | 'success';
interface ToastMessage {
  id: number;
  kind: ToastKind;
  text: string;
}

const ERROR_MS = 6000;
const SUCCESS_MS = 3500;

let current: ToastMessage | null = null;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function showToast(kind: ToastKind, text: string): void {
  const clean = text.trim();
  if (!clean) return;
  current = { id: nextId++, kind, text: clean };
  emit();
  if (timer) clearTimeout(timer);
  timer = setTimeout(hideToast, kind === 'error' ? ERROR_MS : SUCCESS_MS);
}

export function hideToast(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (!current) return;
  current = null;
  emit();
}

/** Hides the popup only if it still shows this text (a newer message stays). */
export function hideToastIf(text: string): void {
  if (current && current.text === text.trim()) hideToast();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = (): ToastMessage | null => current;

export function ToastHost() {
  const { t } = useTranslation();
  const toast = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const insets = useSafeAreaInsets();
  const appear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!toast) return;
    appear.setValue(0);
    Animated.timing(appear, { toValue: 1, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [toast, appear]);

  if (!toast) return null;
  const isError = toast.kind === 'error';
  return (
    <View pointerEvents="box-none" style={[styles.layer, { top: insets.top + 12 }]}>
      <Animated.View
        accessibilityRole="alert"
        accessibilityLiveRegion={isError ? 'assertive' : 'polite'}
        style={[
          styles.toast,
          isError ? styles.error : styles.success,
          { opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] },
        ]}
      >
        <View style={[styles.badge, isError ? styles.badgeError : styles.badgeSuccess]}>
          <Text style={styles.badgeText}>{isError ? '!' : '✓'}</Text>
        </View>
        <Text style={styles.text}>{toast.text}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={hideToast} hitSlop={10} style={styles.close}>
          <CloseIcon size={18} color={colors.white} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 16, zIndex: 1000 },
  toast: {
    width: '100%',
    maxWidth: 520,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: 10,
    borderRadius: radius.button,
    ...shadows.raised,
  },
  error: { backgroundColor: colors.alert },
  success: { backgroundColor: colors.logoIndigo },
  badge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  badgeError: {},
  badgeSuccess: {},
  badgeText: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 15 },
  text: { flex: 1, color: colors.white, fontFamily: fonts.bold, fontSize: 15, lineHeight: 21 },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
