// Kinship engine (LLD L6). Pure: no I/O, so it runs on the server and in the app.
import { normalize } from '@aywo/shared';
import type { Gender } from '@aywo/shared';

export interface KinPerson {
  id: string;
  gender: Gender;
  birthOrder?: number | null;
  birthDate?: string | null;
}
export interface KinUnion {
  id: string;
  partner1Id: string;
  partner2Id?: string | null;
}
export interface KinParentLink {
  parentId: string;
  childId: string;
  kind?: 'birth' | 'adopted' | 'step' | 'foster' | 'unknown';
}
export interface KinGraph {
  persons: KinPerson[];
  unions: KinUnion[];
  parentLinks: KinParentLink[];
}
export interface KinTerm {
  /** The dictionary row, when the words came from the database. */
  id?: string;
  pathCode: string;
  language: string;
  term: string;
  native?: string | null;
  speakerGender?: 'male' | 'female' | null;
  isDefault: boolean;
  status: 'ai_seeded' | 'verified' | 'pending' | 'rejected';
}
export type LabelSource = 'verified' | 'ai' | 'ask' | 'phrase' | 'english';
export interface KinLabel {
  pathCode: string;
  label: string;
  native?: string | null;
  source: LabelSource;
  /** The dictionary row behind this word, so someone can report it. None for a built phrase. With 'ask', the elder word. */
  kinTermId?: string | null;
  /** Elder and younger words, when the order is not known and the language has no neutral word. */
  ask?: KinTerm[];
  /** Second label when the person is related two ways (cousin marriage). */
  also?: { pathCode: string; label: string; native?: string | null } | null;
  /** With 'ask': which two siblings the elder-or-younger question is about (wireframe D4). */
  askAbout?: { linkId: string; siblingId: string } | null;
}
export interface LabelOptions {
  /** Most specific first, e.g. ['zh-Hant-HK', 'zh-Hant-TW', 'zh-Hans']. English is always the last resort. */
  languages: string[];
  terms: KinTerm[];
  viewerGender?: Gender;
}

type Move = 'up' | 'down' | 'across';
interface Step {
  move: Move;
  to: string;
  step: boolean;
}
interface GraphIndex {
  people: Map<string, KinPerson>;
  parents: Map<string, KinParentLink[]>;
  children: Map<string, KinParentLink[]>;
  partners: Map<string, string[]>;
}

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function buildIndex(graph: KinGraph): GraphIndex {
  const index: GraphIndex = { people: new Map(), parents: new Map(), children: new Map(), partners: new Map() };
  for (const p of graph.persons) index.people.set(p.id, p);
  for (const link of graph.parentLinks) {
    pushTo(index.parents, link.childId, link);
    pushTo(index.children, link.parentId, link);
  }
  for (const u of graph.unions) {
    if (!u.partner2Id) continue;
    pushTo(index.partners, u.partner1Id, u.partner2Id);
    pushTo(index.partners, u.partner2Id, u.partner1Id);
  }
  return index;
}

function acrossCount(path: Step[]): number {
  return path.filter((s) => s.move === 'across').length;
}

function edgesOf(index: GraphIndex, id: string): Step[] {
  const edges: Step[] = [];
  for (const l of index.parents.get(id) ?? []) edges.push({ move: 'up', to: l.parentId, step: l.kind === 'step' });
  for (const l of index.children.get(id) ?? []) edges.push({ move: 'down', to: l.childId, step: l.kind === 'step' });
  for (const to of index.partners.get(id) ?? []) edges.push({ move: 'across', to, step: false });
  return edges;
}

/** Shortest path to everyone; on a tie the path with fewer marriage steps wins (L6.2 step 2). */
function searchAll(index: GraphIndex, viewerId: string): Map<string, Step[]> {
  const found = new Map<string, Step[]>();
  found.set(viewerId, []);
  let frontier = [viewerId];
  while (frontier.length > 0) {
    const next = new Map<string, Step[]>();
    for (const id of frontier) {
      const path = found.get(id);
      if (!path) continue;
      for (const edge of edgesOf(index, id)) {
        if (found.has(edge.to)) continue;
        const candidate = path.concat(edge);
        const current = next.get(edge.to);
        if (!current || acrossCount(candidate) < acrossCount(current)) next.set(edge.to, candidate);
      }
    }
    for (const [id, path] of next) found.set(id, path);
    frontier = [...next.keys()];
  }
  return found;
}

/** Blood relatives only: up any number of times, then down. Never up again after going down. */
function searchBlood(index: GraphIndex, viewerId: string): Map<string, Step[]> {
  const found = new Map<string, Step[]>();
  found.set(viewerId, []);
  const seen = new Set<string>();
  let frontier = [{ id: viewerId, descending: false, path: [] as Step[] }];
  while (frontier.length > 0) {
    const next = [];
    for (const node of frontier) {
      for (const edge of edgesOf(index, node.id)) {
        if (edge.move === 'across' || edge.step) continue;
        if (edge.move === 'up' && node.descending) continue;
        const descending = edge.move === 'down';
        const key = `${edge.to}|${descending}`;
        if (seen.has(key) || edge.to === viewerId) continue;
        seen.add(key);
        const path = node.path.concat(edge);
        if (!found.has(edge.to)) found.set(edge.to, path);
        next.push({ id: edge.to, descending, path });
      }
    }
    frontier = next;
  }
  return found;
}

function letter(gender: Gender | undefined, male: string, female: string, neutral: string): string {
  if (gender === 'male') return male;
  if (gender === 'female') return female;
  return neutral;
}

function parentIds(index: GraphIndex, id: string): string[] {
  return (index.parents.get(id) ?? []).map((l) => l.parentId);
}

function isHalfSibling(index: GraphIndex, a: string, b: string): boolean {
  const pa = parentIds(index, a);
  const pb = parentIds(index, b);
  if (pa.length < 2 || pb.length < 2) return false;
  return pa.filter((p) => pb.includes(p)).length === 1;
}

/** '+' when `sibling` is elder than `link`, '-' when younger, '' when not known (L6.2 step 4). */
function elderYounger(index: GraphIndex, link: string, sibling: string): string {
  const a = index.people.get(link);
  const b = index.people.get(sibling);
  if (!a || !b) return '';
  if (a.birthOrder != null && b.birthOrder != null && a.birthOrder !== b.birthOrder) {
    return b.birthOrder < a.birthOrder ? '+' : '-';
  }
  if (a.birthDate && b.birthDate && a.birthDate !== b.birthDate) {
    return b.birthDate < a.birthDate ? '+' : '-';
  }
  return '';
}

interface PathDetail {
  code: string;
  /** The last sibling step whose elder-or-younger order is not known. */
  unknownOrder: { linkId: string; siblingId: string } | null;
}

/** Turns moves into a path code such as M.B or F.B+ (L6.1), merging up-then-down into a sibling. */
function toPathCode(index: GraphIndex, viewerId: string, steps: Step[]): PathDetail {
  const tokens: string[] = [];
  let unknownOrder: PathDetail['unknownOrder'] = null;
  let current = viewerId;
  let i = 0;
  while (i < steps.length) {
    const s = steps[i];
    const after = steps[i + 1];
    const gender = index.people.get(s.to)?.gender;
    if (s.move === 'up' && after && after.move === 'down' && !s.step && !after.step) {
      const sibling = after.to;
      const g = index.people.get(sibling)?.gender;
      const half = isHalfSibling(index, current, sibling) ? 'h' : '';
      const order = elderYounger(index, current, sibling);
      if (!order) unknownOrder = { linkId: current, siblingId: sibling };
      tokens.push(letter(g, 'B', 'Z', 'G') + half + order);
      current = sibling;
      i += 2;
      continue;
    }
    if (s.move === 'up') {
      tokens.push(letter(gender, 'F', 'M', 'P') + (s.step ? '~' : ''));
    } else if (s.move === 'down') {
      const prior = steps[i - 1];
      let isStep = s.step;
      if (prior && prior.move === 'across') {
        const beforeAcross = i >= 2 ? steps[i - 2].to : viewerId;
        if (!parentIds(index, s.to).includes(beforeAcross)) isStep = true;
      }
      tokens.push(letter(gender, 'S', 'D', 'C') + (isStep ? '~' : ''));
    } else {
      // A parent's partner who is not your own parent is a step-parent.
      const prior = steps[i - 1];
      const child = i >= 2 ? steps[i - 2].to : viewerId;
      const isStep = !!prior && prior.move === 'up' && !parentIds(index, child).includes(s.to);
      tokens.push(letter(gender, 'H', 'W', 'E') + (isStep ? '~' : ''));
    }
    current = s.to;
    i += 1;
  }
  return { code: tokens.join('.'), unknownOrder };
}

/** The words for the path letters in one language, for lines such as "Your mother's brother". */
export interface PathWords {
  F: string; M: string; P: string; S: string; D: string; C: string;
  B: string; Z: string; G: string; H: string; W: string; E: string;
  elder: string;
  younger: string;
  half: string;
  step: string;
  /** Goes between people: "'s " in English. */
  join: string;
}

const ENGLISH_WORDS: PathWords = {
  F: 'father', M: 'mother', P: 'parent', S: 'son', D: 'daughter', C: 'child',
  B: 'brother', Z: 'sister', G: 'sibling', H: 'husband', W: 'wife', E: 'spouse',
  elder: 'elder', younger: 'younger', half: 'half-', step: 'step-', join: "'s ",
};

export function describePath(code: string, words: PathWords): string {
  return code
    .split('.')
    .map((token) => {
      const letterKey = token[0];
      const base = letterKey in words ? words[letterKey as keyof PathWords] : letterKey;
      const bits = [];
      if (token.includes('+')) bits.push(words.elder);
      if (token.includes('-')) bits.push(words.younger);
      if (token.includes('h')) bits.push(words.half + base);
      else if (token.includes('~')) bits.push(words.step + base);
      else bits.push(base);
      return bits.join(' ');
    })
    .join(words.join);
}

function englishPhrase(code: string): string {
  return describePath(code, ENGLISH_WORDS);
}

function withoutOrder(code: string): string {
  return code.replace(/[+-]/g, '');
}
function withoutHalfOrStep(code: string): string {
  return code.replace(/[h~]/g, '');
}

/** F.B becomes [F.B+, F.B-]: the words to offer when the order is not known. */
function orderVariants(code: string): string[] {
  const tokens = code.split('.');
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (/^[BZG]h?$/.test(tokens[i])) {
      const elder = tokens.slice();
      const younger = tokens.slice();
      elder[i] += '+';
      younger[i] += '-';
      return [elder.join('.'), younger.join('.')];
    }
  }
  return [];
}

class TermBook {
  private byKey = new Map<string, KinTerm[]>();
  private speaker: Gender | undefined;

  constructor(terms: KinTerm[], speaker: Gender | undefined) {
    this.speaker = speaker;
    for (const t of terms) {
      if (t.status === 'pending' || t.status === 'rejected' || !t.isDefault) continue;
      pushTo(this.byKey, `${t.language}|${t.pathCode}`, t);
    }
  }

  get(language: string, code: string): KinTerm | undefined {
    const all = this.byKey.get(`${language}|${code}`);
    if (!all) return undefined;
    return all.find((t) => t.speakerGender && t.speakerGender === this.speaker) ?? all.find((t) => !t.speakerGender);
  }
}

function fromTerm(code: string, term: KinTerm, englishFallback: boolean): KinLabel {
  return {
    pathCode: code,
    label: term.term,
    native: term.native ?? null,
    source: englishFallback ? 'english' : term.status === 'verified' ? 'verified' : 'ai',
    kinTermId: term.id ?? null,
  };
}

function lookup(book: TermBook, code: string, languages: string[]): KinLabel {
  const tries = [code, withoutOrder(code), withoutHalfOrStep(withoutOrder(code))];
  for (const language of languages) {
    for (const attempt of tries) {
      const term = book.get(language, attempt);
      if (term) return fromTerm(code, term, false);
    }
    // No neutral word (Tamil has none for 'sister'): offer the elder and younger words.
    // Never when the order is already known: there is nothing to ask.
    for (const attempt of /[+-]/.test(code) ? [] : tries) {
      const variants = orderVariants(attempt);
      if (variants.length !== 2) continue;
      const elder = book.get(language, variants[0]);
      const younger = book.get(language, variants[1]);
      if (elder && younger) {
        return { pathCode: code, label: `${elder.term} / ${younger.term}`, native: null, source: 'ask', kinTermId: elder.id ?? null, ask: [elder, younger] };
      }
    }
  }
  for (const attempt of tries) {
    const term = book.get('en', attempt);
    if (term) return fromTerm(code, term, true);
  }
  return { pathCode: code, label: englishPhrase(code), native: null, source: 'phrase' };
}

/** Labels every related person from the viewer's place (L6.2). The viewer gets no label. */
export function labelTree(graph: KinGraph, viewerId: string, options: LabelOptions): Record<string, KinLabel> {
  const index = buildIndex(graph);
  const viewer = index.people.get(viewerId);
  const book = new TermBook(options.terms, options.viewerGender ?? viewer?.gender);
  const shortest = searchAll(index, viewerId);
  const blood = searchBlood(index, viewerId);
  const out: Record<string, KinLabel> = {};

  for (const [id, path] of shortest) {
    if (id === viewerId) continue;
    const pathDetail = toPathCode(index, viewerId, path);
    const bloodPath = blood.get(id);
    const bloodDetail = bloodPath ? toPathCode(index, viewerId, bloodPath) : null;
    const isOwnPartner = path.length === 1 && path[0].move === 'across';

    // L6.2 step 6: blood label first, except that your own partner is always your partner first.
    const primary = bloodDetail && !isOwnPartner ? bloodDetail : pathDetail;
    const second = bloodDetail && !isOwnPartner ? pathDetail : bloodDetail;
    const primaryCode = primary.code;
    const secondCode = second ? second.code : null;
    const label = lookup(book, primaryCode, options.languages);
    if (label.source === 'ask') label.askAbout = primary.unknownOrder;
    if (secondCode && secondCode !== primaryCode) {
      const second = lookup(book, secondCode, options.languages);
      label.also = { pathCode: secondCode, label: second.label, native: second.native ?? null };
    }
    out[id] = label;
  }
  return out;
}

/** T-KIN-01: finds the words a person may be typing, however they are spaced or capitalised. */
export function suggestTerms(terms: KinTerm[], language: string, query: string): KinTerm[] {
  const q = normalize(query);
  if (!q) return [];
  return terms.filter(
    (t) => t.language === language && t.status !== 'rejected' && normalize(t.term).startsWith(q),
  );
}
