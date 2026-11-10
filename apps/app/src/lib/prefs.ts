// Choices kept on this device: language and large text. Saved to the account too once signed in.
import { useSyncExternalStore } from 'react';
import { deviceStore } from '@/lib/api';
import i18n, { ensureLocale } from '@/i18n';
import { applyLayoutDirection } from '@/i18n/rtl';
import { largeTextScale } from '@/theme/tokens';

const LANGUAGE = 'aywo.language';
const LARGE_TEXT = 'aywo.largeText';

let largeText = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLargeText(): boolean {
  return useSyncExternalStore(subscribe, () => largeText, () => largeText);
}

/** How much to multiply text by right now. */
export function useTextScale(): number {
  return useLargeText() ? largeTextScale : 1;
}

export async function setLargeText(on: boolean): Promise<void> {
  largeText = on;
  listeners.forEach((listener) => listener());
  await deviceStore.set(LARGE_TEXT, on ? '1' : '0');
}

export async function setLanguage(code: string): Promise<void> {
  ensureLocale(code);
  await i18n.changeLanguage(code);
  applyLayoutDirection(code);
  await deviceStore.set(LANGUAGE, code);
}

export function isLargeText(): boolean {
  return largeText;
}

/** Runs once when the app starts, before the first screen shows. */
export async function loadPrefs(): Promise<void> {
  const [language, large] = await Promise.all([deviceStore.get(LANGUAGE), deviceStore.get(LARGE_TEXT)]);
  if (language) {
    ensureLocale(language);
    await i18n.changeLanguage(language);
  }
  applyLayoutDirection(i18n.language);
  if (large === '1') {
    largeText = true;
    listeners.forEach((listener) => listener());
  }
}
