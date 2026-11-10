// Lighten mind-map importer (LLD L8.2). Pure: takes content.json, returns a preview to correct before commit.
import { normalize } from '@aywo/shared';
import type { Gender } from '@aywo/shared';

export interface LightenTopic {
  id: string;
  title?: string;
  subtopics?: LightenTopic[];
}
export interface LightenRelationship {
  startNodeId: string;
  endNodeId: string;
}
export interface LightenContent {
  mapName?: string;
  rootTopic: LightenTopic;
  relationships?: LightenRelationship[];
}

export interface ImportedPerson {
  tempId: string;
  displayName: string;
  nameUnknown: boolean;
  noteLabel: string | null;
  gender: Gender;
  /** True when the gender was worked out from the partner, so the preview should show it for checking. */
  genderGuessed: boolean;
  birthOrder: number | null;
}
export interface ImportedUnion {
  tempId: string;
  partner1Id: string;
  partner2Id: string;
  seq1: number;
}
export interface ImportedParentLink {
  parentId: string;
  childId: string;
  unionId: string | null;
}
/** What a placeholder box was drawn under, so it can become a 'Name unknown' child if the person says yes. */
export interface ImportPlaceholder {
  underPerson: string;
  tempId: string;
  /** As drawn, before any merge. import_commit follows them through the merges that stay. */
  parentIds: string[];
  unionId: string | null;
}
/**
 * Everything a merge changed, by position, so import_commit can undo it when the person answers 'No, two people'.
 * Positions are safe because unions and parentLinks only ever grow. Undo newest merge first.
 */
export interface MergeUndo {
  unions: { index: number; field: 'partner1Id' | 'partner2Id' }[];
  links: { index: number; field: 'parentId' | 'childId' }[];
  /** Links that were given the couple's union by the merge. */
  linkUnions: number[];
  /** Links only the merge added. */
  addedLinks: number[];
}
export interface ImportMerge {
  name: string;
  keptId: string;
  droppedId: string;
  /** The person as they were before the merge. */
  dropped: ImportedPerson;
  undo: MergeUndo;
}
export interface ImportPreview {
  mapName: string;
  persons: ImportedPerson[];
  unions: ImportedUnion[];
  parentLinks: ImportedParentLink[];
  /** 'Subtopic' boxes: a space kept under this person's name, to be added later. */
  placeholders: ImportPlaceholder[];
  /** Same person drawn in two places, merged into one. */
  merges: ImportMerge[];
  /** Links the importer could not resolve, shown to the user. */
  problems: { code: string; detail: string }[];
  counts: {
    topics: number;
    couplesSplit: number;
    merges: number;
    people: number;
    couples: number;
    generations: number;
    genderUnknown: number;
  };
}

interface Family {
  primaryId: string;
  parentIds: string[];
  unionId: string | null;
}

const SPOUSE_NOTE = /\b(wife|husband)\b/i;
const CHILD_NOTE = /\b(\d+)(?:st|nd|rd|th)\s+(son|daughter|child)\b/i;

function splitBracket(text: string): { name: string; note: string | null } {
  const match = text.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (!match) return { name: text.trim(), note: null };
  return { name: match[1].trim(), note: match[2].trim() };
}

export function parseLighten(content: LightenContent): ImportPreview {
  const persons = new Map<string, ImportedPerson>();
  const unions: ImportedUnion[] = [];
  const parentLinks: ImportedParentLink[] = [];
  const placeholders: ImportPlaceholder[] = [];
  const problems: { code: string; detail: string }[] = [];
  const merges: ImportMerge[] = [];
  const peopleOfTopic = new Map<string, string[]>();
  let topics = 0;
  let couplesSplit = 0;

  function addPerson(tempId: string, rawName: string): ImportedPerson {
    const { name, note } = splitBracket(rawName);
    const nameUnknown = normalize(name) === 'name unknown';
    const child = note ? note.match(CHILD_NOTE) : null;
    let gender: Gender = 'unknown';
    if (child) {
      const word = child[2].toLowerCase();
      if (word === 'son') gender = 'male';
      if (word === 'daughter') gender = 'female';
    }
    const person: ImportedPerson = {
      tempId,
      displayName: name,
      nameUnknown,
      noteLabel: note,
      gender,
      genderGuessed: false,
      birthOrder: child ? Number(child[1]) : null,
    };
    persons.set(tempId, person);
    return person;
  }

  function addUnion(tempId: string, a: string, b: string): void {
    const seq1 = unions.filter((u) => u.partner1Id === a).length + 1;
    unions.push({ tempId, partner1Id: a, partner2Id: b, seq1 });
  }

  function linkChild(family: Family | null, childId: string): void {
    if (!family) return;
    for (const parentId of family.parentIds) parentLinks.push({ parentId, childId, unionId: family.unionId });
  }

  function walk(topic: LightenTopic, family: Family | null): void {
    topics += 1;
    const title = (topic.title ?? '').trim();

    if (normalize(title) === 'subtopic') {
      const under = family ? persons.get(family.primaryId) : undefined;
      placeholders.push({
        underPerson: under ? under.displayName : '',
        tempId: `${topic.id}#p`,
        parentIds: family ? family.parentIds : [],
        unionId: family ? family.unionId : null,
      });
      return;
    }

    let own: Family;
    const parts = title.split(/\s+\/\s+/);
    const single = splitBracket(title);
    const spouseOfParent = family !== null && single.note !== null && SPOUSE_NOTE.test(single.note);

    if (parts.length === 2) {
      // 'A / B': A sits in this family, B is A's partner.
      couplesSplit += 1;
      const a = addPerson(`${topic.id}#a`, parts[0]);
      const b = addPerson(`${topic.id}#b`, parts[1]);
      peopleOfTopic.set(topic.id, [a.tempId, b.tempId]);
      const unionId = `${topic.id}#u`;
      addUnion(unionId, a.tempId, b.tempId);
      linkChild(family, a.tempId);
      own = { primaryId: a.tempId, parentIds: [a.tempId, b.tempId], unionId };
    } else if (spouseOfParent && family) {
      // 'Rani Bai (Second Wife)': a partner of the parent topic, not a child. Their children sit under them.
      const spouse = addPerson(`${topic.id}#a`, title);
      const isWife = /wife/i.test(single.note ?? '');
      spouse.gender = isWife ? 'female' : 'male';
      const partner = persons.get(family.primaryId);
      if (partner && partner.gender === 'unknown') partner.gender = isWife ? 'male' : 'female';
      peopleOfTopic.set(topic.id, [spouse.tempId]);
      const unionId = `${topic.id}#u`;
      addUnion(unionId, family.primaryId, spouse.tempId);
      own = { primaryId: family.primaryId, parentIds: [family.primaryId, spouse.tempId], unionId };
    } else {
      const person = addPerson(`${topic.id}#a`, title);
      peopleOfTopic.set(topic.id, [person.tempId]);
      linkChild(family, person.tempId);
      own = { primaryId: person.tempId, parentIds: [person.tempId], unionId: null };
    }

    for (const sub of topic.subtopics ?? []) walk(sub, own);
  }

  walk(content.rootTopic, null);

  // Same person in two places (cousin marriage): keep the one in their blood position.
  for (const rel of content.relationships ?? []) {
    const start = peopleOfTopic.get(rel.startNodeId) ?? [];
    const end = peopleOfTopic.get(rel.endNodeId) ?? [];
    let matched = false;
    for (const s of start) {
      for (const e of end) {
        const ps = persons.get(s);
        const pe = persons.get(e);
        if (!ps || !pe || matched || s === e) continue;
        if (normalize(ps.displayName) !== normalize(pe.displayName)) continue;
        const startHasParents = parentLinks.some((l) => l.childId === s);
        const keptId = startHasParents ? s : e;
        const droppedId = startHasParents ? e : s;
        const dropped = persons.get(droppedId);
        if (!dropped) continue;
        const copy = { ...dropped };
        merges.push({ name: ps.displayName, keptId, droppedId, dropped: copy, undo: mergePeople(keptId, droppedId) });
        matched = true;
      }
    }
    if (!matched) problems.push({ code: 'link_not_matched', detail: `${rel.startNodeId} -> ${rel.endNodeId}` });
  }

  function mergePeople(keptId: string, droppedId: string): MergeUndo {
    const undo: MergeUndo = { unions: [], links: [], linkUnions: [], addedLinks: [] };
    const kept = persons.get(keptId);
    const dropped = persons.get(droppedId);
    if (kept && dropped && kept.gender === 'unknown') kept.gender = dropped.gender;
    persons.delete(droppedId);
    unions.forEach((u, index) => {
      if (u.partner1Id === droppedId) {
        u.partner1Id = keptId;
        undo.unions.push({ index, field: 'partner1Id' });
      }
      if (u.partner2Id === droppedId) {
        u.partner2Id = keptId;
        undo.unions.push({ index, field: 'partner2Id' });
      }
    });
    parentLinks.forEach((l, index) => {
      if (l.parentId === droppedId) {
        l.parentId = keptId;
        undo.links.push({ index, field: 'parentId' });
      }
      if (l.childId === droppedId) {
        l.childId = keptId;
        undo.links.push({ index, field: 'childId' });
      }
    });
    // Children drawn under the kept person now belong to the couple, so the partner becomes their parent too.
    const own = unions.filter((u) => u.partner1Id === keptId || u.partner2Id === keptId);
    if (own.length !== 1) return undo;
    const union = own[0];
    const partnerId = union.partner1Id === keptId ? union.partner2Id : union.partner1Id;
    const looseLinks = parentLinks.flatMap((l, index) => (l.parentId === keptId && l.unionId === null ? [{ link: l, index }] : []));
    for (const { link, index } of looseLinks) {
      link.unionId = union.tempId;
      undo.linkUnions.push(index);
      undo.addedLinks.push(parentLinks.length);
      parentLinks.push({ parentId: partnerId, childId: link.childId, unionId: union.tempId });
    }
    return undo;
  }

  // A partner of someone with a known gender is shown as the opposite, flagged for checking.
  for (const u of unions) {
    const a = persons.get(u.partner1Id);
    const b = persons.get(u.partner2Id);
    if (!a || !b) continue;
    if (a.gender === 'unknown' && (b.gender === 'male' || b.gender === 'female')) {
      a.gender = b.gender === 'male' ? 'female' : 'male';
      a.genderGuessed = true;
    } else if (b.gender === 'unknown' && (a.gender === 'male' || a.gender === 'female')) {
      b.gender = a.gender === 'male' ? 'female' : 'male';
      b.genderGuessed = true;
    }
  }

  const list = [...persons.values()];
  return {
    mapName: content.mapName ?? content.rootTopic.title ?? '',
    persons: list,
    unions,
    parentLinks,
    placeholders,
    merges,
    problems,
    counts: {
      topics,
      couplesSplit,
      merges: merges.length,
      people: list.length,
      couples: unions.length,
      generations: countGenerations(list, parentLinks),
      genderUnknown: list.filter((p) => p.gender === 'unknown').length,
    },
  };
}

function countGenerations(persons: ImportedPerson[], links: ImportedParentLink[]): number {
  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const l of links) {
    const list = childrenOf.get(l.parentId);
    if (list) list.push(l.childId);
    else childrenOf.set(l.parentId, [l.childId]);
    hasParent.add(l.childId);
  }
  const memo = new Map<string, number>();
  function depth(id: string): number {
    const known = memo.get(id);
    if (known !== undefined) return known;
    let best = 1;
    for (const c of childrenOf.get(id) ?? []) best = Math.max(best, depth(c) + 1);
    memo.set(id, best);
    return best;
  }
  let most = 0;
  for (const p of persons) if (!hasParent.has(p.tempId)) most = Math.max(most, depth(p.tempId));
  return most;
}

/** The user's corrections from the preview screen. */
export function applyGenderFixes(preview: ImportPreview, fixes: Record<string, Gender>): ImportPreview {
  const persons = preview.persons.map((p) => {
    const gender = fixes[p.tempId];
    return gender ? { ...p, gender, genderGuessed: false } : p;
  });
  return {
    ...preview,
    persons,
    counts: { ...preview.counts, genderUnknown: persons.filter((p) => p.gender === 'unknown').length },
  };
}
