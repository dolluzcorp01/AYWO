// What POST /import/upload answers: the preview from packages/lighten and packages/gedcom.
export type ImportGender = 'male' | 'female' | 'other' | 'unknown';

export interface ImportedPerson {
  tempId: string;
  displayName: string;
  nameUnknown: boolean;
  noteLabel: string | null;
  gender: ImportGender;
  genderGuessed?: boolean;
}

export interface ImportPlaceholder {
  underPerson: string;
  tempId: string;
  parentIds: string[];
  unionId: string | null;
}

export interface ImportMerge {
  name: string;
  keptId: string;
  droppedId: string;
  dropped: ImportedPerson;
  /** Everything the merge changed, by position in the lists below. */
  undo: {
    unions: { index: number; field: 'partner1Id' | 'partner2Id' }[];
    links: { index: number; field: 'parentId' | 'childId' }[];
    linkUnions: number[];
    addedLinks: number[];
  };
}

export interface ImportPreview {
  mapName?: string;
  persons: ImportedPerson[];
  unions: { tempId: string; partner1Id: string; partner2Id: string | null }[];
  parentLinks: { parentId: string; childId: string; unionId: string | null }[];
  placeholders?: ImportPlaceholder[];
  merges?: ImportMerge[];
  problems?: { code: string; detail: string }[];
  counts?: { people?: number; couples?: number; generations?: number };
}

export interface ImportAnswer {
  import_id: string;
  preview: ImportPreview;
}

/**
 * The preview as it will be with these merges undone, so the next steps show the second person too.
 * The same steps as import_commit in db/migrations/0010: newest merge first, by position.
 */
export function withSplits(preview: ImportPreview, droppedIds: string[]): ImportPreview {
  if (droppedIds.length === 0) return preview;
  const persons = [...preview.persons];
  const unions = preview.unions.map((u) => ({ ...u }));
  const links: (ImportPreview['parentLinks'][number] | null)[] = preview.parentLinks.map((l) => ({ ...l }));
  for (const merge of [...(preview.merges ?? [])].reverse()) {
    if (!droppedIds.includes(merge.droppedId)) continue;
    persons.push(merge.dropped);
    for (const { index, field } of merge.undo.unions) unions[index][field] = merge.droppedId;
    for (const { index, field } of merge.undo.links) {
      const link = links[index];
      if (link) link[field] = merge.droppedId;
    }
    for (const index of merge.undo.linkUnions) {
      const link = links[index];
      if (link) link.unionId = null;
    }
    for (const index of merge.undo.addedLinks) links[index] = null;
  }
  return {
    ...preview,
    persons,
    unions,
    parentLinks: links.filter((l): l is ImportPreview['parentLinks'][number] => l !== null),
    counts: preview.counts ? { ...preview.counts, people: persons.length } : undefined,
  };
}

/** Names of a person's parents and partners, used to tell people with the same name apart. */
export function relativesOf(preview: ImportPreview, tempId: string): { parents: string[]; partners: string[] } {
  const nameOf = (id: string | null) => preview.persons.find((p) => p.tempId === id)?.displayName ?? null;
  const parents = preview.parentLinks.filter((l) => l.childId === tempId).map((l) => nameOf(l.parentId));
  const partners = preview.unions
    .filter((u) => u.partner1Id === tempId || u.partner2Id === tempId)
    .map((u) => nameOf(u.partner1Id === tempId ? u.partner2Id : u.partner1Id));
  return {
    parents: parents.filter((n): n is string => !!n),
    partners: partners.filter((n): n is string => !!n),
  };
}
