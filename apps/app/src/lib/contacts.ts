// Cleans a typed contact into the stored form used for 'Is this you?' matching and for opening the dialler.
import { toE164 } from '@/lib/phone';

export function normalizeContact(kind: 'mobile' | 'whatsapp' | 'email', value: string): string | null {
  const text = value.trim();
  if (kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text.toLowerCase() : null;
  // A number without its + code is read as the device's country (India unless it clearly says otherwise).
  return toE164(text);
}

// The date boxes ('Born', 'Died'): year, month and year, or a full date, keeping how exact the stored date is.
// The code is in @/tree/dateText, which imports nothing, so its tests run without a device.
export { dateFromBox, dateToText, parseDateText } from '@/tree/dateText';
export type { StoredDate, TypedPrecision } from '@/tree/dateText';
