// GEDCOM import and export (LLD L8.1). Pure. Reads 5.5.1 and 7.0 into the same preview as Lighten; writes 5.5.1 UTF-8.
// Kept to plain TypeScript on purpose: a simple type stripper runs the tests.
import type { ImportedParentLink, ImportedPerson, ImportedUnion, ImportPreview } from '@aywo/lighten';

export type PersonGender = 'male' | 'female' | 'other' | 'unknown';
export type DatePrecision = 'exact' | 'month' | 'year' | 'about' | 'unknown';
export type LivingState = 'living' | 'deceased' | 'unknown';
export type LinkKind = 'birth' | 'adopted' | 'step' | 'foster' | 'unknown';
export type UnionKind = 'marriage' | 'partnership' | 'unknown';
export type UnionStatus = 'current' | 'divorced' | 'separated' | 'widowed' | 'annulled' | 'unknown';

/** A preview person, plus what a GEDCOM file can say and a Lighten map cannot. import_commit reads these when present. */
export interface GedcomPerson extends ImportedPerson {
  living: LivingState;
  birthDate: string | null;
  birthPrecision: DatePrecision | null;
  /** The date as the file wrote it, for example 'BEF 1950', shown in the preview. */
  birthDateText: string | null;
  birthPlace: string | null;
  deathDate: string | null;
  deathPrecision: DatePrecision | null;
  deathDateText: string | null;
  deathPlace: string | null;
  notes: string | null;
  photoFile: string | null;
}
export interface GedcomUnion extends ImportedUnion {
  kind: UnionKind;
  status: UnionStatus;
  startDate: string | null;
  endDate: string | null;
}
export interface GedcomParentLink extends ImportedParentLink {
  kind: LinkKind;
}

export interface ParsedDate {
  date: string | null;
  precision: DatePrecision | null;
  text: string | null;
}

interface Line {
  level: number;
  xref: string | null;
  tag: string;
  value: string;
  children: Line[];
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const LINE = /^\s*(\d{1,2})(?:\s+(@[^@\s]+@))?\s+([A-Za-z0-9_]+)(?: (.*))?$/;
const UNKNOWN_NAME = 'Name unknown';
const POINTER = /^@[^@\s]+@$/;

function pad(n: number, width: number): string {
  let s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function firstChild(line: Line, tag: string): Line | null {
  for (const c of line.children) if (c.tag === tag) return c;
  return null;
}

function childValue(line: Line, tag: string): string | null {
  const c = firstChild(line, tag);
  return c && c.value !== '' ? c.value : null;
}

function childText(line: Line, tag: string): string | null {
  const c = firstChild(line, tag);
  if (!c) return null;
  const text = fullText(c);
  return text !== '' ? text : null;
}

function unescapeValue(value: string): string {
  return value.replace(/@@/g, '@');
}

/** CONC joins with nothing, CONT with a new line. 7.0 has only CONT. */
function fullText(line: Line): string {
  let text = line.value;
  for (const c of line.children) {
    if (c.tag === 'CONC') text += c.value;
    if (c.tag === 'CONT') text += '\n' + c.value;
  }
  return text;
}

function parseLines(text: string, problems: { code: string; detail: string }[]): Line[] {
  const roots: Line[] = [];
  const stack: Line[] = [];
  const raw = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i].trim() === '') continue;
    const m = raw[i].match(LINE);
    if (!m) {
      problems.push({ code: 'gedcom_bad_line', detail: `line ${i + 1}` });
      continue;
    }
    const level = Number(m[1]);
    const line: Line = { level: level, xref: m[2] ? m[2] : null, tag: m[3].toUpperCase(), value: m[4] ? m[4] : '', children: [] };
    if (!POINTER.test(line.value)) line.value = unescapeValue(line.value);
    while (stack.length > level) stack.pop();
    if (level === 0) {
      roots.push(line);
    } else if (stack.length === level) {
      stack[level - 1].children.push(line);
    } else {
      problems.push({ code: 'gedcom_bad_line', detail: `line ${i + 1}` });
      continue;
    }
    stack.push(line);
  }
  return roots;
}

/** One calendar date in GEDCOM words. Only the Gregorian calendar turns into a stored date. */
function parseSingleDate(text: string): { date: string; precision: DatePrecision } | null {
  let t = text.trim().toUpperCase();
  if (t.includes('@#D') || t.startsWith('JULIAN') || t.startsWith('HEBREW') || t.startsWith('FRENCH_R')) {
    if (!t.startsWith('@#DGREGORIAN@') && !t.startsWith('GREGORIAN')) return null;
    t = t.replace(/^@#DGREGORIAN@\s*/, '').replace(/^GREGORIAN\s*/, '');
  }
  if (/\b(B\.?C\.?|BCE)$/.test(t)) return null;
  const parts = t.split(/\s+/);
  const yearPart = parts[parts.length - 1];
  // A dual year such as 1699/00 means the first one.
  const yearMatch = yearPart.match(/^(\d{3,4})(?:\/\d{1,2})?$/);
  if (!yearMatch) return null;
  const year = Number(yearMatch[1]);
  if (parts.length === 1) return { date: `${pad(year, 4)}-01-01`, precision: 'year' };
  const month = MONTHS.indexOf(parts[parts.length - 2]) + 1;
  if (month === 0) return null;
  if (parts.length === 2) return { date: `${pad(year, 4)}-${pad(month, 2)}-01`, precision: 'month' };
  if (parts.length !== 3 || !/^\d{1,2}$/.test(parts[0])) return null;
  const day = Number(parts[0]);
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { date: `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`, precision: 'exact' };
}

/**
 * Keeps the precision (L8.1). The database has one 'about', so ABT, CAL, EST, BEF, AFT and ranges all land there;
 * the words the file used stay in text.
 */
export function parseGedcomDate(value: string | null): ParsedDate {
  if (!value || value.trim() === '') return { date: null, precision: null, text: null };
  const text = value.trim();
  const upper = text.toUpperCase();
  const qualified = upper.match(/^(ABT|CAL|EST|BEF|AFT)\.?\s+(.*)$/);
  if (qualified) {
    const inner = parseSingleDate(qualified[2]);
    return inner ? { date: inner.date, precision: 'about', text: text } : { date: null, precision: null, text: text };
  }
  const range = upper.match(/^(?:BET|FROM)\.?\s+(.*?)(?:\s+(?:AND|TO)\s+.*)?$/);
  if (range) {
    const inner = parseSingleDate(range[1]);
    return inner ? { date: inner.date, precision: 'about', text: text } : { date: null, precision: null, text: text };
  }
  const toOnly = upper.match(/^TO\s+(.*)$/);
  if (toOnly) {
    const inner = parseSingleDate(toOnly[1]);
    return inner ? { date: inner.date, precision: 'about', text: text } : { date: null, precision: null, text: text };
  }
  const plain = parseSingleDate(text);
  return plain ? { date: plain.date, precision: plain.precision, text: text } : { date: null, precision: null, text: text };
}

function cleanName(value: string): string {
  return value.replace(/\//g, ' ').replace(/\s+/g, ' ').trim();
}

function personName(indi: Line): string {
  const name = firstChild(indi, 'NAME');
  if (!name) return '';
  const whole = cleanName(fullText(name));
  if (whole !== '') return whole;
  const pieces = [childValue(name, 'GIVN'), childValue(name, 'SURN')].filter((p) => p !== null);
  return cleanName(pieces.join(' '));
}

function genderOf(indi: Line): PersonGender {
  const custom = childValue(indi, '_GENDER');
  if (custom && custom.toLowerCase() === 'other') return 'other';
  const sex = (childValue(indi, 'SEX') || '').toUpperCase();
  if (sex === 'M') return 'male';
  if (sex === 'F') return 'female';
  if (sex === 'X') return 'other';
  return 'unknown';
}

function eventDate(event: Line | null): ParsedDate {
  if (!event) return { date: null, precision: null, text: null };
  return parseGedcomDate(childValue(event, 'DATE'));
}

function pedigreeKind(value: string | null): LinkKind {
  const v = (value || '').toLowerCase();
  if (v === 'birth') return 'birth';
  if (v === 'adopted') return 'adopted';
  if (v === 'foster') return 'foster';
  if (v === 'step') return 'step';
  return 'unknown';
}

/** A note is its text, or a pointer to a NOTE (5.5.1) or SNOTE (7.0) record. */
function notesOf(indi: Line, records: Map<string, Line>): string | null {
  const texts: string[] = [];
  for (const c of indi.children) {
    if (c.tag !== 'NOTE' && c.tag !== 'SNOTE') continue;
    const target = POINTER.test(c.value) ? records.get(c.value) : undefined;
    const text = target ? fullText(target) : POINTER.test(c.value) ? '' : fullText(c);
    if (text.trim() !== '') texts.push(text.trim());
  }
  return texts.length > 0 ? texts.join('\n\n') : null;
}

function photoOf(indi: Line, records: Map<string, Line>): string | null {
  const obje = firstChild(indi, 'OBJE');
  if (!obje) return null;
  const source = POINTER.test(obje.value) ? records.get(obje.value) : obje;
  if (!source) return null;
  const file = childValue(source, 'FILE');
  if (!file) return null;
  const pieces = file.split(/[\\/]/);
  return pieces[pieces.length - 1];
}

function pointerOf(line: Line | null): string | null {
  if (!line || !POINTER.test(line.value) || line.value === '@VOID@') return null;
  return line.value;
}

function reaches(from: string, to: string, childrenOf: Map<string, string[]>): boolean {
  const seen: Set<string> = new Set();
  const todo = [from];
  while (todo.length > 0) {
    const id = todo.pop() as string;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const c of childrenOf.get(id) || []) todo.push(c);
  }
  return false;
}

function countGenerations(persons: GedcomPerson[], childrenOf: Map<string, string[]>, hasParent: Set<string>): number {
  const memo: Map<string, number> = new Map();
  function depth(id: string): number {
    const known = memo.get(id);
    if (known !== undefined) return known;
    let best = 1;
    for (const c of childrenOf.get(id) || []) best = Math.max(best, depth(c) + 1);
    memo.set(id, best);
    return best;
  }
  let most = 0;
  for (const p of persons) if (!hasParent.has(p.tempId)) most = Math.max(most, depth(p.tempId));
  return most;
}

/** Reads a GEDCOM 5.5.1 or 7.0 file. Throws only when it is not a GEDCOM file; anything smaller becomes a problem. */
export function readGedcom(text: string): ImportPreview {
  const problems: { code: string; detail: string }[] = [];
  const roots = parseLines(text, problems);
  const head = roots.length > 0 && roots[0].tag === 'HEAD' ? roots[0] : null;
  if (!head) throw new Error('not a GEDCOM file');

  const charset = (childValue(head, 'CHAR') || 'UTF-8').toUpperCase();
  if (charset !== 'UTF-8' && charset !== 'UTF8' && charset !== 'ASCII') {
    problems.push({ code: 'gedcom_not_utf8', detail: charset });
  }

  const records: Map<string, Line> = new Map();
  for (const r of roots) if (r.xref) records.set(r.xref, r);

  const persons: GedcomPerson[] = [];
  const personIds: Set<string> = new Set();
  for (const r of roots) {
    if (r.tag !== 'INDI') continue;
    if (!r.xref) {
      problems.push({ code: 'gedcom_person_without_id', detail: personName(r) });
      continue;
    }
    const name = personName(r);
    const birth = firstChild(r, 'BIRT');
    const death = firstChild(r, 'DEAT');
    const born = eventDate(birth);
    const died = eventDate(death);
    if (born.text && !born.date) problems.push({ code: 'gedcom_date_not_understood', detail: born.text });
    if (died.text && !died.date) problems.push({ code: 'gedcom_date_not_understood', detail: died.text });
    const order = Number(childValue(r, '_BIRTH_ORDER'));
    persons.push({
      tempId: r.xref,
      displayName: name === '' ? UNKNOWN_NAME : name,
      nameUnknown: name === '',
      noteLabel: childText(r, '_LABEL'),
      gender: genderOf(r),
      genderGuessed: false,
      birthOrder: Number.isInteger(order) && order > 0 ? order : null,
      living: death ? 'deceased' : 'unknown',
      birthDate: born.date,
      birthPrecision: born.precision,
      birthDateText: born.text,
      birthPlace: birth ? childText(birth, 'PLAC') : null,
      deathDate: died.date,
      deathPrecision: died.precision,
      deathDateText: died.text,
      deathPlace: death ? childText(death, 'PLAC') : null,
      notes: notesOf(r, records),
      photoFile: photoOf(r, records),
    });
    personIds.add(r.xref);
  }
  const personById: Map<string, GedcomPerson> = new Map();
  for (const p of persons) personById.set(p.tempId, p);

  const unions: GedcomUnion[] = [];
  const parentLinks: GedcomParentLink[] = [];
  const linkKeys: Set<string> = new Set();
  const childrenOf: Map<string, string[]> = new Map();
  const hasParent: Set<string> = new Set();

  function known(pointer: string | null, family: string): string | null {
    if (!pointer) return null;
    if (personIds.has(pointer)) return pointer;
    problems.push({ code: 'gedcom_link_not_matched', detail: `${family} -> ${pointer}` });
    return null;
  }

  function addLink(parentId: string, childId: string, unionId: string | null, kind: LinkKind): void {
    const key = `${parentId}|${childId}`;
    if (linkKeys.has(key)) return;
    // The database refuses a family loop, and one bad line should not cost the whole file.
    if (parentId === childId || reaches(childId, parentId, childrenOf)) {
      problems.push({ code: 'gedcom_family_loop', detail: `${parentId} -> ${childId}` });
      return;
    }
    linkKeys.add(key);
    parentLinks.push({ parentId: parentId, childId: childId, unionId: unionId, kind: kind });
    const list = childrenOf.get(parentId);
    if (list) list.push(childId);
    else childrenOf.set(parentId, [childId]);
    hasParent.add(childId);
  }

  // Children may be listed on the family, on the child (FAMC), or both. FAMC carries the kind of link.
  const familyChildren: Map<string, string[]> = new Map();
  const kindOfChild: Map<string, LinkKind> = new Map();
  for (const r of roots) {
    if (r.tag !== 'INDI' || !r.xref) continue;
    for (const c of r.children) {
      if (c.tag !== 'FAMC') continue;
      const family = pointerOf(c);
      if (!family) continue;
      const list = familyChildren.get(family);
      if (list) list.push(r.xref);
      else familyChildren.set(family, [r.xref]);
      kindOfChild.set(`${family}|${r.xref}`, pedigreeKind(childValue(c, 'PEDI')));
    }
  }

  for (const r of roots) {
    if (r.tag !== 'FAM') continue;
    const family = r.xref ? r.xref : '(no id)';
    const husband = known(pointerOf(firstChild(r, 'HUSB')), family);
    const wife = known(pointerOf(firstChild(r, 'WIFE')), family);
    const parents: string[] = [];
    if (husband) parents.push(husband);
    if (wife && wife !== husband) parents.push(wife);

    let unionId: string | null = null;
    if (husband && wife && husband !== wife) {
      unionId = `${family}#u`;
      const marriage = firstChild(r, 'MARR');
      const divorce = firstChild(r, 'DIV');
      const annulled = firstChild(r, 'ANUL');
      let status: UnionStatus = 'unknown';
      if (divorce) status = 'divorced';
      else if (annulled) status = 'annulled';
      unions.push({
        tempId: unionId,
        partner1Id: husband,
        partner2Id: wife,
        seq1: unions.filter((u) => u.partner1Id === husband).length + 1,
        kind: marriage ? 'marriage' : 'unknown',
        status: status,
        startDate: eventDate(marriage).date,
        endDate: eventDate(divorce).date,
      });
      // Someone listed as husband or wife with no SEX line: shown for checking, like Lighten's partner guess.
      const h = personById.get(husband);
      const w = personById.get(wife);
      if (h && h.gender === 'unknown') {
        h.gender = 'male';
        h.genderGuessed = true;
      }
      if (w && w.gender === 'unknown') {
        w.gender = 'female';
        w.genderGuessed = true;
      }
    }

    const children: string[] = [];
    for (const c of r.children) {
      if (c.tag !== 'CHIL') continue;
      const child = known(pointerOf(c), family);
      if (child && !children.includes(child)) children.push(child);
    }
    for (const child of familyChildren.get(family) || []) {
      if (!children.includes(child)) children.push(child);
    }
    if (parents.length === 0 && children.length > 0) {
      problems.push({ code: 'gedcom_family_without_parents', detail: family });
    }
    for (const child of children) {
      const kind = kindOfChild.get(`${family}|${child}`) || 'unknown';
      for (const parent of parents) addLink(parent, child, unionId, kind);
    }
  }

  const headFile = childValue(head, 'FILE');
  return {
    mapName: headFile ? headFile.replace(/\.[A-Za-z0-9]{1,5}$/, '') : '',
    persons: persons,
    unions: unions,
    parentLinks: parentLinks,
    placeholders: [],
    merges: [],
    problems: problems,
    counts: {
      topics: 0,
      couplesSplit: 0,
      merges: 0,
      people: persons.length,
      couples: unions.length,
      generations: countGenerations(persons, childrenOf, hasParent),
      genderUnknown: persons.filter((p) => p.gender === 'unknown').length,
    },
  };
}

// ===== Export =====

export interface ExportPersonRow {
  id: string;
  display_name: string;
  name_unknown?: boolean;
  note_label?: string | null;
  gender: PersonGender;
  living: LivingState;
  birth_date?: string | null;
  death_date?: string | null;
  birth_precision?: DatePrecision | null;
  death_precision?: DatePrecision | null;
  birth_place?: string | null;
  death_place?: string | null;
  birth_order?: number | null;
  notes?: string | null;
}
export interface ExportUnionRow {
  id: string;
  partner1_id: string;
  partner2_id: string | null;
  kind?: UnionKind;
  status?: UnionStatus;
  start_date?: string | null;
  end_date?: string | null;
}
export interface ExportLinkRow {
  parent_id: string;
  child_id: string;
  union_id: string | null;
  kind?: LinkKind;
}
export interface GedcomData {
  treeName?: string;
  persons: ExportPersonRow[];
  unions: ExportUnionRow[];
  links: ExportLinkRow[];
}
export interface WriteOptions {
  includeLiving: boolean;
}
interface Family {
  ref: string;
  husband: string | null;
  wife: string | null;
  union: ExportUnionRow | null;
  children: { id: string; kind: LinkKind }[];
}

/**
 * Anyone not clearly dead counts as living, because a wrong guess here publishes a living person's dates.
 * Born over 110 years ago counts as dead. `today` is passed in so the rule can be tested.
 */
export function countsAsLiving(p: ExportPersonRow, today: Date): boolean {
  if (p.living === 'deceased' || p.death_date) return false;
  if (p.living === 'living') return true;
  if (p.birth_date) {
    const year = Number(p.birth_date.slice(0, 4));
    if (Number.isFinite(year) && today.getUTCFullYear() - year > 110) return false;
  }
  return true;
}

function gedcomDate(date: string, precision: DatePrecision | null | undefined): string | null {
  const m = date.match(/^(\d{1,4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const paddedYear = pad(Number(m[1]), 3);
  const monthWord = MONTHS[Number(m[2]) - 1];
  if (precision === 'year') return paddedYear;
  if (precision === 'about') return m[2] === '01' ? `ABT ${paddedYear}` : `ABT ${monthWord} ${paddedYear}`;
  if (precision === 'month') return `${monthWord} ${paddedYear}`;
  if (precision === 'unknown') return paddedYear;
  return `${Number(m[3])} ${monthWord} ${paddedYear}`;
}

/** Breaks a value over CONC and CONT lines. Lines stay well under the 255 limit, and never split before a space. */
function valueLines(level: number, tag: string, value: string): string[] {
  const out: string[] = [];
  const escaped = value.replace(/@/g, '@@');
  const parts = escaped.split(/\r\n|\r|\n/);
  for (let i = 0; i < parts.length; i += 1) {
    const pieces: string[] = [];
    let rest = parts[i];
    while (rest.length > 180) {
      let cut = 180;
      while (cut > 1 && (rest[cut] === ' ' || rest[cut - 1] === ' ' || isLowSurrogate(rest.charCodeAt(cut)))) cut -= 1;
      if (cut <= 1) cut = 180;
      if (isLowSurrogate(rest.charCodeAt(cut))) cut -= 1;
      pieces.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    pieces.push(rest);
    for (let j = 0; j < pieces.length; j += 1) {
      if (i === 0 && j === 0) out.push(pieces[j] === '' ? `${level} ${tag}` : `${level} ${tag} ${pieces[j]}`);
      else if (j === 0) out.push(pieces[j] === '' ? `${level + 1} CONT` : `${level + 1} CONT ${pieces[j]}`);
      else out.push(`${level + 1} CONC ${pieces[j]}`);
    }
  }
  return out;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function hasText(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && value.trim() !== '';
}

/** GEDCOM 5.5.1 UTF-8. Contact details are not in the input at all. Living people's dates, places and notes stay out unless ticked. */
export function writeGedcom(data: GedcomData, options: WriteOptions): string {
  const today = new Date();
  const lines: string[] = [];
  const fileName = (data.treeName || 'family-tree').replace(/[\r\n@]/g, ' ').trim();
  lines.push('0 HEAD', '1 SOUR AYWO', '2 NAME AYWO', '1 SUBM @SUB1@');
  lines.push('1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8');
  lines.push(`1 FILE ${fileName === '' ? 'family-tree' : fileName}.ged`);
  lines.push('0 @SUB1@ SUBM', '1 NAME AYWO');

  const personRef: Map<string, string> = new Map();
  const byId: Map<string, ExportPersonRow> = new Map();
  const ordered = data.persons.slice();
  for (let i = 0; i < ordered.length; i += 1) {
    personRef.set(ordered[i].id, `@I${i + 1}@`);
    byId.set(ordered[i].id, ordered[i]);
  }
  function isHidden(id: string | null): boolean {
    if (options.includeLiving || !id) return false;
    const p = byId.get(id);
    return p ? countsAsLiving(p, today) : false;
  }

  // Families: each couple, plus one family per lone parent for links that do not belong to a couple.
  const families: Family[] = [];
  const familyOfUnion: Map<string, Family> = new Map();
  const familyOfParent: Map<string, Family> = new Map();

  for (const u of data.unions) {
    if (!personRef.has(u.partner1_id)) continue;
    const partner2 = u.partner2_id && personRef.has(u.partner2_id) ? u.partner2_id : null;
    // WIFE goes to the female partner when that is clear; two men or two women simply fill both places.
    const firstIsWife = byId.get(u.partner1_id)?.gender === 'female' && (partner2 === null || byId.get(partner2)?.gender !== 'female');
    const family: Family = {
      ref: `@F${families.length + 1}@`,
      husband: firstIsWife ? partner2 : u.partner1_id,
      wife: firstIsWife ? u.partner1_id : partner2,
      union: u,
      children: [],
    };
    families.push(family);
    familyOfUnion.set(u.id, family);
  }

  const parentsOf: Map<string, ExportLinkRow[]> = new Map();
  for (const l of data.links) {
    if (!personRef.has(l.parent_id) || !personRef.has(l.child_id)) continue;
    const list = parentsOf.get(l.child_id);
    if (list) list.push(l);
    else parentsOf.set(l.child_id, [l]);
  }

  for (const p of ordered) {
    const links = parentsOf.get(p.id) || [];
    const placed: Set<string> = new Set();
    for (const l of links) {
      if (placed.has(l.parent_id)) continue;
      const family = l.union_id ? familyOfUnion.get(l.union_id) : undefined;
      // A family line means both partners are parents, so it is used only when the child really has both.
      if (family) {
        const partners = [family.husband, family.wife].filter((x) => x !== null);
        const hasAll = partners.length === 2 && partners.every((x) => links.some((o) => o.parent_id === x && o.union_id === l.union_id));
        if (hasAll) {
          family.children.push({ id: p.id, kind: l.kind || 'unknown' });
          for (const x of partners) placed.add(x as string);
          continue;
        }
      }
      let lone = familyOfParent.get(l.parent_id);
      if (!lone) {
        const parent = byId.get(l.parent_id);
        const asWife = parent?.gender === 'female';
        lone = {
          ref: `@F${families.length + 1}@`,
          husband: asWife ? null : l.parent_id,
          wife: asWife ? l.parent_id : null,
          union: null,
          children: [],
        };
        families.push(lone);
        familyOfParent.set(l.parent_id, lone);
      }
      lone.children.push({ id: p.id, kind: l.kind || 'unknown' });
      placed.add(l.parent_id);
    }
  }

  const familyLines: Map<string, string[]> = new Map();
  function addFamilyLines(personId: string, more: string[]): void {
    const list = familyLines.get(personId);
    if (list) list.push(...more);
    else familyLines.set(personId, more);
  }
  for (const f of families) {
    for (const c of f.children) {
      addFamilyLines(c.id, c.kind === 'unknown' ? [`1 FAMC ${f.ref}`] : [`1 FAMC ${f.ref}`, `2 PEDI ${c.kind}`]);
    }
    if (f.husband) addFamilyLines(f.husband, [`1 FAMS ${f.ref}`]);
    if (f.wife) addFamilyLines(f.wife, [`1 FAMS ${f.ref}`]);
  }

  for (const p of ordered) {
    const hidden = isHidden(p.id);
    lines.push(`0 ${personRef.get(p.id)} INDI`);
    const name = p.name_unknown ? '' : cleanName(p.display_name);
    lines.push(...valueLines(1, 'NAME', name === '' ? '//' : name));
    if (p.gender === 'male') lines.push('1 SEX M');
    else if (p.gender === 'female') lines.push('1 SEX F');
    else lines.push('1 SEX U');
    if (p.gender === 'other') lines.push('1 _GENDER other');
    if (hasText(p.note_label)) lines.push(...valueLines(1, '_LABEL', p.note_label as string));
    if (p.birth_order) lines.push(`1 _BIRTH_ORDER ${p.birth_order}`);

    if (!hidden && (p.birth_date || hasText(p.birth_place))) {
      lines.push('1 BIRT');
      const when = p.birth_date ? gedcomDate(p.birth_date, p.birth_precision) : null;
      if (when) lines.push(`2 DATE ${when}`);
      if (hasText(p.birth_place)) lines.push(...valueLines(2, 'PLAC', p.birth_place as string));
    }
    if (p.living === 'deceased' || p.death_date) {
      if (p.death_date || hasText(p.death_place)) {
        lines.push('1 DEAT');
        const when = p.death_date ? gedcomDate(p.death_date, p.death_precision) : null;
        if (when) lines.push(`2 DATE ${when}`);
        if (hasText(p.death_place)) lines.push(...valueLines(2, 'PLAC', p.death_place as string));
      } else {
        lines.push('1 DEAT Y');
      }
    }
    if (!hidden && hasText(p.notes)) lines.push(...valueLines(1, 'NOTE', p.notes as string));

    lines.push(...(familyLines.get(p.id) || []));
  }

  for (const f of families) {
    lines.push(`0 ${f.ref} FAM`);
    if (f.husband) lines.push(`1 HUSB ${personRef.get(f.husband)}`);
    if (f.wife) lines.push(`1 WIFE ${personRef.get(f.wife)}`);
    const u = f.union;
    if (u) {
      // A couple's dates are hidden if either partner's are.
      const hideDates = isHidden(f.husband) || isHidden(f.wife);
      if (u.kind === 'marriage' || (u.start_date && !hideDates)) {
        lines.push('1 MARR');
        if (u.start_date && !hideDates) {
          const when = gedcomDate(u.start_date, 'exact');
          if (when) lines.push(`2 DATE ${when}`);
        }
      }
      if (u.status === 'divorced') {
        lines.push('1 DIV');
        if (u.end_date && !hideDates) {
          const when = gedcomDate(u.end_date, 'exact');
          if (when) lines.push(`2 DATE ${when}`);
        }
      } else if (u.status === 'annulled') {
        lines.push('1 ANUL');
      }
    }
    for (const c of f.children) lines.push(`1 CHIL ${personRef.get(c.id)}`);
  }

  lines.push('0 TRLR');
  return lines.join('\r\n') + '\r\n';
}
