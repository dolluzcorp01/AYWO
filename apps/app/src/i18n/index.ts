import { languageChain } from '@aywo/shared';
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enUS from '../../../../locales/en-US.json';
import enUSAdmin from '../../../../locales/en-US.admin.json';
import enUSOps from '../../../../locales/en-US.ops.json';
import enUSP1 from '../../../../locales/en-US.p1.json';
import enUSPay from '../../../../locales/en-US.pay.json';
import enUSSocial from '../../../../locales/en-US.social.json';
import { GENERATED_LOCALES } from '../../../../locales/generated';
import ta from '../../../../locales/ta.json';
import taAdmin from '../../../../locales/ta.admin.json';
import taOps from '../../../../locales/ta.ops.json';
import taP1 from '../../../../locales/ta.p1.json';
import taPay from '../../../../locales/ta.pay.json';
import taSocial from '../../../../locales/ta.social.json';
import { matchPhoneLanguage } from './languages';

type Strings = Record<string, unknown>;

function isGroup(value: unknown): value is Strings {
  return !!value && typeof value === 'object';
}

// Each area keeps its own file, and each may add to the shared 'errors' group, so groups are joined rather than replaced.
function join(...files: Strings[]): Strings {
  const out: Strings = {};
  for (const file of files) {
    for (const [key, value] of Object.entries(file)) {
      const current = out[key];
      out[key] = isGroup(current) && isGroup(value) ? join(current, value) : value;
    }
  }
  return out;
}

const SOURCE = 'en-US';

// English is the source and the fallback (LLD L12). Tamil's hand-written first draft sits on top of its generated file.
function stringsFor(code: string): Strings | null {
  if (code === SOURCE) return join(enUS, enUSP1, enUSPay, enUSAdmin, enUSSocial, enUSOps);
  const generated = GENERATED_LOCALES[code]?.() ?? null;
  if (code === 'ta') return join(generated ?? {}, ta, taP1, taPay, taAdmin, taSocial, taOps);
  return generated;
}

/** LLD L12: zh-Hant-HK falls back to zh-Hant-TW, then zh-Hans; pt-PT to pt-BR. Everything ends at English. */
function fallbacksOf(code: string): string[] {
  return [...new Set([...languageChain(code).slice(1), SOURCE])].filter((c) => c !== code);
}

const loaded = new Set<string>();

function chainStrings(code: string): [string, Strings][] {
  const out: [string, Strings][] = [];
  for (const each of [code, ...fallbacksOf(code)]) {
    if (loaded.has(each)) continue;
    loaded.add(each);
    const strings = stringsFor(each);
    if (strings) out.push([each, strings]);
  }
  return out;
}

/** Call before changing language. Files load only when needed, because the app has one for every language. */
export function ensureLocale(code: string): void {
  for (const [each, strings] of chainStrings(code)) i18n.addResourceBundle(each, 'translation', strings, true, true);
}

function phoneLanguage(): string {
  const locale = getLocales()[0];
  return matchPhoneLanguage(locale?.languageTag, locale?.languageCode);
}

const firstLanguage = phoneLanguage();

i18n.use(initReactI18next).init({
  resources: Object.fromEntries(chainStrings(firstLanguage).map(([code, strings]) => [code, { translation: strings }])),
  lng: firstLanguage,
  fallbackLng: (code: string) => fallbacksOf(code),
  interpolation: { escapeValue: false },
});

export default i18n;
