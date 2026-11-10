export * from './tree-view.ts';
export * from './person-card.ts';
export * from './pay.ts';

export type Gender = 'male' | 'female' | 'other' | 'unknown';

/** LLD L1: Unicode NFKC, lower-case, trim, collapse spaces. Mirrors aywo_normalize() in SQL. */
export function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
}
