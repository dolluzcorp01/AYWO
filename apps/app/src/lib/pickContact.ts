// Picking one person from the phone's contacts, to fill in a relative's name and number.
// The phone's own picker opens; AYWO only ever sees the one contact chosen, never the whole address book.
// Phones: expo-contacts. Web: the browser Contact Picker (Chrome on Android); elsewhere on the web it is not offered.
import { Contact, requestPermissionsAsync } from 'expo-contacts';
import { Platform } from 'react-native';
import type { CountryCode } from 'libphonenumber-js';
import { defaultCountry, toE164 } from '@/lib/phone';

export interface PickedContact {
  name: string;
  phones: string[];
}

/** Raised when the person said no to contacts access, so the screen can explain instead of failing quietly. */
export class ContactsDenied extends Error {}

interface WebContactsManager {
  select: (props: string[], options: { multiple: boolean }) => Promise<{ name?: string[]; tel?: string[] }[]>;
}

function webPicker(): WebContactsManager | null {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return null;
  const contacts = (navigator as unknown as { contacts?: WebContactsManager }).contacts;
  return contacts && typeof contacts.select === 'function' ? contacts : null;
}

/** Whether this device can offer "Choose from contacts" at all. */
export function canPickContact(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android' || webPicker() !== null;
}

function clean(name: string | null | undefined, phones: (string | null | undefined)[]): PickedContact {
  return {
    name: (name ?? '').replace(/\s+/g, ' ').trim(),
    phones: [...new Set(phones.map((p) => (p ?? '').trim()).filter(Boolean))],
  };
}

/** Opens the picker. Null when the person closed it without choosing. */
export async function pickContact(): Promise<PickedContact | null> {
  const web = webPicker();
  if (web) {
    const [chosen] = await web.select(['name', 'tel'], { multiple: false });
    return chosen ? clean(chosen.name?.[0], chosen.tel ?? []) : null;
  }
  // Android reads the chosen contact through the contacts permission; iOS's picker shares it without one,
  // but asking keeps both phones the same and lets the details be read back.
  const permission = await requestPermissionsAsync();
  if (!permission.granted && Platform.OS === 'android') throw new ContactsDenied();
  const chosen = await Contact.presentPicker();
  if (!chosen) return null;
  const [name, phones] = await Promise.all([chosen.getFullName(), chosen.getPhones()]);
  return clean(name, phones.map((p) => p.number));
}

/**
 * The number to use from a contact: the first that is a real phone number (contacts often keep landlines and old
 * numbers too), in +91... form. Null when the contact has no number.
 */
export function bestNumber(picked: PickedContact, country: CountryCode = defaultCountry()): string | null {
  for (const phone of picked.phones) {
    const e164 = toE164(phone, country);
    if (e164) return e164;
  }
  return picked.phones[0] ?? null;
}
