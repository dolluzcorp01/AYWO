// Phone numbers the way families type them: just the 10 digits, with the country code picked for them.
// The country starts from the device's time zone, because browsers and phones in India very often report en-US.
import { getCalendars, getLocales } from 'expo-localization';
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';

const TIME_ZONE_COUNTRY: Record<string, CountryCode> = {
  'Asia/Kolkata': 'IN',
  'Asia/Calcutta': 'IN',
  'Asia/Colombo': 'LK',
  'Asia/Singapore': 'SG',
  'Asia/Dubai': 'AE',
  'Asia/Muscat': 'OM',
  'Asia/Qatar': 'QA',
  'Asia/Riyadh': 'SA',
  'Asia/Kuala_Lumpur': 'MY',
  'Europe/London': 'GB',
  'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU',
};

const ALL = new Set<string>(getCountries());

/** The country a new phone number starts with. India unless the device clearly says otherwise. */
export function defaultCountry(): CountryCode {
  const zone = getCalendars()[0]?.timeZone ?? '';
  if (TIME_ZONE_COUNTRY[zone]) return TIME_ZONE_COUNTRY[zone];
  const region = getLocales()[0]?.regionCode ?? '';
  // en-US is what most browsers say whatever the country, so it is not trusted on its own.
  if (region && region !== 'US' && ALL.has(region)) return region as CountryCode;
  if (zone.startsWith('America/') && region === 'US') return 'US';
  return 'IN';
}

export function callingCode(country: CountryCode): string {
  return `+${getCountryCallingCode(country)}`;
}

export interface CountryOption {
  code: CountryCode;
  name: string;
  dial: string;
}

const FIRST: CountryCode[] = ['IN', 'US', 'GB', 'AE', 'SG', 'CA', 'AU', 'LK', 'MY', 'OM', 'QA', 'SA'];

/** Every country with its calling code, the common ones for AYWO families first, names in the app language. */
export function countryOptions(language: string): CountryOption[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([language, 'en'], { type: 'region' });
  } catch {
    names = null;
  }
  const make = (code: CountryCode): CountryOption => ({ code, name: names?.of(code) ?? code, dial: callingCode(code) });
  const rest = getCountries()
    .filter((c) => !FIRST.includes(c))
    .map(make)
    .sort((a, b) => a.name.localeCompare(b.name, language));
  return [...FIRST.map(make), ...rest];
}

/** Splits a saved or typed number into the country box and the number box. */
export function splitPhone(value: string, fallback: CountryCode): { country: CountryCode; national: string } {
  const text = value.trim();
  if (text.startsWith('+')) {
    const parsed = parsePhoneNumberFromString(text);
    if (parsed?.country) return { country: parsed.country, national: parsed.nationalNumber };
    // "+91" alone, or a number still being typed.
    const digits = text.slice(1).replace(/\D/g, '');
    for (const country of [fallback, ...getCountries()]) {
      const code = getCountryCallingCode(country);
      if (digits.startsWith(code)) return { country, national: digits.slice(code.length) };
    }
  }
  return { country: fallback, national: text };
}

/**
 * What a phone box hands back: "+<country code><digits>", or '' when the number box is empty.
 * A number typed with its own + code keeps it. A leading 0 (as many Indians write mobiles) is dropped.
 */
export function joinPhone(country: CountryCode, national: string): string {
  const text = national.trim();
  if (!text) return '';
  if (text.startsWith('+')) return `+${text.slice(1).replace(/\D/g, '')}`;
  const digits = text.replace(/\D/g, '').replace(/^0+/, '');
  return digits ? `${callingCode(country)}${digits}` : '';
}

/** The stored international form (+919876543210), or null when it is not a real number. */
export function toE164(value: string, country: CountryCode = defaultCountry()): string | null {
  const text = value.trim();
  if (!text) return null;
  const parsed = text.startsWith('+') ? parsePhoneNumberFromString(text) : parsePhoneNumberFromString(text, country);
  return parsed && parsed.isValid() ? parsed.number : null;
}
