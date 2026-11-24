// Choices kept on this device: language, large text and Elder mode. Saved to the account too once signed in.
import { useSyncExternalStore } from 'react';
import { deviceStore } from '@/lib/api';
import i18n, { ensureLocale, isTranslated } from '@/i18n';
import { applyLayoutDirection } from '@/i18n/rtl';
import { largeTextScale } from '@/theme/tokens';

const LANGUAGE = 'aywo.language';
const LARGE_TEXT = 'aywo.largeText';
const SIMPLE = 'aywo.simpleMode';

let largeText = false;
let simpleMode = false;
// What the person changed with their own hand since the app opened. A choice made on Welcome a moment before
// signing in is what they want now, so signing in must not put the account's older setting back over it.
type Pref = 'language' | 'largeText' | 'simpleMode';
const chosenHere = new Set<Pref>();
/** `auto`: set by the app (the account's saved choice, the phone's region), not by the person. */
interface SetOptions { auto?: boolean }
export function choseHere(pref: Pref): boolean {
  return chosenHere.has(pref);
}
/** Once signed in (and at sign-out) the list starts again, so one person's choice is never saved to the next account. */
export function forgetChosenHere(): void {
  chosenHere.clear();
}
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

export async function setLargeText(on: boolean, options: SetOptions = {}): Promise<void> {
  if (!options.auto) chosenHere.add('largeText');
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
export async function setSimpleMode(on: boolean, options: SetOptions = {}): Promise<void> {
  if (!options.auto) chosenHere.add('simpleMode');
  simpleMode = on;
  listeners.forEach((listener) => listener());
  await deviceStore.set(SIMPLE, on ? '1' : '0');
  if (on && !largeText) await setLargeText(true, options);
}

/** Buttons grow in Elder mode so they are easier to hit. */
export function useTapSize(base: number): number {
  return useSimpleMode() ? Math.round(base * 1.3) : base;
}

export async function setLanguage(code: string, options: SetOptions = {}): Promise<void> {
  if (!options.auto) chosenHere.add('language');
  ensureLocale(code);
  await i18n.changeLanguage(code);
  applyLayoutDirection(code, isTranslated(code));
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
  applyLayoutDirection(i18n.language, isTranslated(i18n.language));
  if (large === '1' || simple === '1') {
    largeText = large === '1' || simple === '1';
    simpleMode = simple === '1';
    listeners.forEach((listener) => listener());
  }
}
