// LLD L12: the right-to-left languages mirror the layout. The native apps can only switch direction on a restart.
import { useSyncExternalStore } from 'react';
import { I18nManager, Platform } from 'react-native';

// The same five as rtl = true in db/seed/languages.sql.
const RTL_LOCALES = new Set(['ks-Arab', 'pa-Arab', 'sd-Arab', 'ur', 'ar']);

export function isRtlLocale(code: string): boolean {
  return RTL_LOCALES.has(code);
}

let restartNeeded = false;
const listeners = new Set<() => void>();

function setRestartNeeded(needed: boolean): void {
  restartNeeded = needed;
  listeners.forEach((listener) => listener());
}

/** Applies the language's direction. On Android and iOS a change waits for a restart, so this asks for one. */
export function applyLayoutDirection(code: string): void {
  const rtl = isRtlLocale(code);
  if (Platform.OS === 'web') {
    // React Native Web's own I18nManager does nothing. Flex rows and text follow the page's dir.
    const page = globalThis.document?.documentElement;
    if (page) {
      page.dir = rtl ? 'rtl' : 'ltr';
      page.lang = code;
    }
    return;
  }
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  // 'left' and 'right' stay physical: the tree canvas places cards and lines by them. Screens use start and end.
  I18nManager.swapLeftAndRightInRTL(false);
  setRestartNeeded(I18nManager.isRTL !== rtl);
}

/** True when the layout is mirrored right now. For arrows, which must point the way the screen flows. */
export function layoutIsRtl(): boolean {
  if (Platform.OS === 'web') return globalThis.document?.documentElement?.dir === 'rtl';
  return I18nManager.isRTL;
}

export function useRestartNeeded(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => restartNeeded,
    () => false,
  );
}

export function dismissRestart(): void {
  setRestartNeeded(false);
}

export async function restartApp(): Promise<void> {
  // Loaded here because the module exists only in the apps.
  const Updates = await import('expo-updates');
  await Updates.reloadAsync();
}
