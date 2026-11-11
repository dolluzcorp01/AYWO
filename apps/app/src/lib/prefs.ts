// Choices kept on this device: language, large text and Elder mode. Saved to the account too once signed in.
import { useSyncExternalStore } from 'react';
import { deviceStore } from '@/lib/api';
import i18n, { ensureLocale } from '@/i18n';
import { applyLayoutDirection } from '@/i18n/rtl';
import { largeTextScale } from '@/theme/tokens';

const LANGUAGE = 'aywo.language';
const LARGE_TEXT = 'aywo.largeText';
const SIMPLE = 'aywo.simpleMode';

let largeText = false;
let simpleMode = false;
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

export function useSimpleMode(): boolean {
  return useSyncExternalStore(subscribe, () => simpleMode, () => simpleMode);
}

export function isSimpleMode(): boolean {
  return simpleMode;
}

/** Elder mode: the simple Home with big buttons. Turning it on turns large text on too; turning it off leaves text as it is. */
export async function setSimpleMode(on: boolean): Promise<void> {
  simpleMode = on;
  listeners.forEach((listener) => listener());
  await deviceStore.set(SIMPLE, on ? '1' : '0');
  if (on && !largeText) await setLargeText(true);
}

/** Buttons grow in Elder mode so they are easier to hit. */
export function useTapSize(base: number): number {
  return useSimpleMode() ? Math.round(base * 1.3) : base;
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
  const [language, large, simple] = await Promise.all([deviceStore.get(LANGUAGE), deviceStore.get(LARGE_TEXT), deviceStore.get(SIMPLE)]);
  if (language) {
    ensureLocale(language);
    await i18n.changeLanguage(language);
  }
  applyLayoutDirection(i18n.language);
  if (large === '1' || simple === '1') {
    largeText = large === '1' || simple === '1';
    simpleMode = simple === '1';
    listeners.forEach((listener) => listener());
  }
}
