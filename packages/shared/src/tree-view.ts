// What each kind of visitor may receive. Everything goes through an explicit list of fields,
// so a new database column can never reach an outsider by accident (T-VIEW-01).

export interface PersonRow {
  id: string;
  display_name: string;
  name_unknown: boolean;
  note_label: string | null;
  gender: string;
  living: string;
  birth_date: string | null;
  death_date: string | null;
  birth_precision: string | null;
  death_precision: string | null;
  birth_place: string | null;
  death_place: string | null;
  birth_order: number | null;
  photo_path: string | null;
  notes: string | null;
  claimed_by: string | null;
  version: number;
}

export interface OutsiderNode {
  id: string;
  name: string;
  nameUnknown: boolean;
  photoUrl: string | null;
}

export function toOutsiderNode(row: PersonRow, photoUrl: string | null): OutsiderNode {
  return { id: row.id, name: row.display_name, nameUnknown: row.name_unknown, photoUrl };
}

export function toMemberNode(row: PersonRow, photoUrl: string | null) {
  return {
    id: row.id,
    name: row.display_name,
    nameUnknown: row.name_unknown,
    noteLabel: row.note_label,
    gender: row.gender,
    living: row.living,
    birthDate: row.birth_date,
    deathDate: row.death_date,
    birthPrecision: row.birth_precision,
    deathPrecision: row.death_precision,
    birthPlace: row.birth_place,
    deathPlace: row.death_place,
    birthOrder: row.birth_order,
    notes: row.notes,
    joined: row.claimed_by !== null,
    version: row.version,
    photoUrl,
  };
}

/** A share's branch: the person, their descendants, and the partners of all of those (LLD shares.scope_person_id). */
export function branchIds(
  descendantIds: string[],
  unions: { partner1_id: string; partner2_id: string | null }[],
): Set<string> {
  const blood = new Set(descendantIds);
  const ids = new Set(descendantIds);
  for (const u of unions) {
    if (blood.has(u.partner1_id) && u.partner2_id) ids.add(u.partner2_id);
    else if (u.partner2_id && blood.has(u.partner2_id)) ids.add(u.partner1_id);
  }
  return ids;
}

const NEXT_LANGUAGE: Record<string, string> = {
  'en-GB': 'en-US',
  'en-IN': 'en-US',
  'zh-Hant-HK': 'zh-Hant-TW',
  'zh-Hant-TW': 'zh-Hans',
  'pt-PT': 'pt-BR',
  'ms-SG': 'ms-MY',
};

/** LLD L12 fallback chain, most specific first. The kinship dictionary follows the same chain. */
export function languageChain(code: string): string[] {
  const chain: string[] = [];
  let current = code;
  while (current && !chain.includes(current)) {
    chain.push(current);
    const next = NEXT_LANGUAGE[current];
    if (next) current = next;
    else current = current.includes('-') ? current.slice(0, current.lastIndexOf('-')) : '';
  }
  return chain;
}
