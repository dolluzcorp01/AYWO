// Turns a focus view into the rows on the 'My view' screen (wireframes A8, B3).
import type { FocusView } from './focus-view.ts';

export type SectionKey = 'grandparents' | 'parents' | 'partners' | 'siblings' | 'children' | 'siblingsChildren';

export interface FocusSection {
  key: SectionKey;
  /** The parent or sibling this group hangs from, for headings such as "Amma's parents". */
  viaPersonId: string | null;
  /** Two tiles per row on the phone. */
  rows: string[][];
}
export interface FocusSections {
  above: FocusSection[];
  below: FocusSection[];
}

function inRows(ids: string[]): string[][] {
  const rows: string[][] = [];
  for (let i = 0; i < ids.length; i += 2) rows.push(ids.slice(i, i + 2));
  return rows;
}

function section(key: SectionKey, ids: string[], viaPersonId: string | null = null): FocusSection {
  return { key, viaPersonId, rows: inRows(ids) };
}

export function focusSections(view: FocusView): FocusSections {
  const above = view.grandparents.map((g) => section('grandparents', g.ids, g.viaParentId));
  if (view.parents.length > 0) above.push(section('parents', view.parents));

  const below: FocusSection[] = [];
  if (view.partners.length > 0) below.push(section('partners', view.partners));
  if (view.siblings.length > 0) below.push(section('siblings', view.siblings));
  if (view.children.length > 0) below.push(section('children', view.children));
  for (const g of view.siblingsChildren) below.push(section('siblingsChildren', g.ids, g.siblingId));
  return { above, below };
}

/** The 'Close family' chips on the person card (wireframe D1): partner first, then parents, children, siblings. */
export function closeFamily(view: FocusView, max = 6): string[] {
  const all = [...view.partners, ...view.parents, ...view.children, ...view.siblings];
  return [...new Set(all)].slice(0, max);
}

export interface RelationInput {
  label: string;
  source: string;
  ask?: { term: string }[];
}
export type RelationText =
  | { kind: 'none' }
  | { kind: 'word'; word: string }
  | { kind: 'ask'; elder: string; younger: string };

/** What the tile shows under the name. 'Akka or Thangai?' is a question for the user, drawn in its own colour. */
export function relationText(label: RelationInput | undefined | null): RelationText {
  if (!label) return { kind: 'none' };
  if (label.source === 'ask' && label.ask && label.ask.length === 2) {
    return { kind: 'ask', elder: label.ask[0].term, younger: label.ask[1].term };
  }
  // Shown as a title on cards and lists: a built-up English phrase ("sister's child") starts with a capital too.
  // Mid-sentence use lowers it again (see the share screen).
  const word = label.label;
  return { kind: 'word', word: word.charAt(0).toLocaleUpperCase() + word.slice(1) };
}
