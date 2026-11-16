// The name to print for a person. Someone whose name is not known is stored with the plain marker 'Name unknown'
// (the importer, add_relative and the SQL all use it), which must never reach the screen as it is: it is English.
import type { TFunction } from 'i18next';

/** What display_name holds when the name is not known. Stored, never shown. */
export const UNKNOWN_NAME_MARKER = 'Name unknown';

export function isUnknownName(name: string | null | undefined, nameUnknown?: boolean | null): boolean {
  return !!nameUnknown || (name ?? '').trim() === UNKNOWN_NAME_MARKER;
}

/** The person's name, or the translated 'Name not known'. Pass `nameUnknown` where the screen has it. */
export function shownName(t: TFunction, name: string | null | undefined, nameUnknown?: boolean | null): string {
  if (isUnknownName(name, nameUnknown)) return t('tree.nameNotKnown');
  return (name ?? '').trim() || t('tree.nameNotKnown');
}

/** First name for a sentence ("Want to call Meena?"), or 'Name not known' in full. */
export function shownFirstName(t: TFunction, name: string | null | undefined, nameUnknown?: boolean | null): string {
  if (isUnknownName(name, nameUnknown)) return t('tree.nameNotKnown');
  return (name ?? '').trim().split(/\s+/)[0] || t('tree.nameNotKnown');
}
