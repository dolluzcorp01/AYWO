// Shared by translate-locales.ts, check-locales.ts and seed-kin-terms.ts.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LOCALES = join(ROOT, 'locales');
export const GENERATED = join(LOCALES, 'generated');
export const SOURCE_LOCALE = 'en-US';

export type Flat = Record<string, string>;
type Nested = { [key: string]: string | Nested };

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

export function flatten(value: Nested, prefix = ''): Flat {
  const out: Flat = {};
  for (const [key, inner] of Object.entries(value)) {
    if (typeof inner === 'string') out[prefix + key] = inner;
    else Object.assign(out, flatten(inner, `${prefix}${key}.`));
  }
  return out;
}

export function unflatten(flat: Flat): Nested {
  const out: Nested = {};
  for (const [path, text] of Object.entries(flat)) {
    const parts = path.split('.');
    let at = out;
    for (const part of parts.slice(0, -1)) at = (at[part] ??= {}) as Nested;
    at[parts[parts.length - 1]] = text;
  }
  return out;
}

function readJson(path: string): Nested {
  return JSON.parse(readFileSync(path, 'utf8')) as Nested;
}

// The order apps/app/src/i18n joins them in, because several areas add to 'errors' and the later file wins.
const AREA_ORDER = ['', 'p1.', 'pay.', 'admin.', 'social.', 'ops.'];

/** Every area's file for one locale, joined: locales/en-US.json, en-US.p1.json and so on. */
export function readAreaFiles(locale: string): Flat {
  const flat: Flat = {};
  const present = new Set(readdirSync(LOCALES));
  for (const area of AREA_ORDER) {
    const name = `${locale}.${area}json`;
    if (present.has(name)) Object.assign(flat, flatten(readJson(join(LOCALES, name))));
  }
  return flat;
}

export function readGenerated(locale: string): Flat {
  const path = join(GENERATED, `${locale}.json`);
  return existsSync(path) ? flatten(readJson(path)) : {};
}

export function writeGenerated(locale: string, flat: Flat): void {
  mkdirSync(GENERATED, { recursive: true });
  writeFileSync(join(GENERATED, `${locale}.json`), `${JSON.stringify(unflatten(flat), null, 2)}\n`);
}

export interface SeedLanguage {
  code: string;
  name: string;
  script: string;
  rtl: boolean;
}

/** The locked list in db/seed/languages.sql. 'en' is only the dictionary's base, so it has no locale file of its own. */
export function readLanguages(): SeedLanguage[] {
  const sql = readFileSync(join(ROOT, 'db', 'seed', 'languages.sql'), 'utf8');
  const rows = [...sql.matchAll(/^\s*\('([^']+)', '((?:[^']|'')+)', '((?:[^']|'')+)', (true|false), (?:true|false)\)/gm)];
  return rows.map((row) => ({ code: row[1], name: row[2].replace(/''/g, "'"), script: row[3].replace(/''/g, "'"), rtl: row[4] === 'true' }));
}

export function readLocales(): SeedLanguage[] {
  return readLanguages().filter((language) => language.code !== 'en');
}

/** The plural forms this language needs. i18next picks x_one, x_few and so on from the same rules, with x_other for the rest. */
export function pluralCategories(locale: string): string[] {
  let found: string[] = [];
  try {
    found = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  } catch {
    found = ['one'];
  }
  return CATEGORIES.filter((category) => category === 'other' || found.includes(category));
}

export interface TargetEntry {
  key: string;
  english: string;
  /** Set for a plural form, and {{count}} may be left out of any form but 'other'. */
  plural: string | null;
}

/** Every key this locale must have. Each plural family turns into the forms that language needs, so 'every key' is not the same list everywhere. */
export function targetEntries(source: Flat, locale: string): TargetEntry[] {
  const entries: TargetEntry[] = [];
  const done = new Set<string>();
  for (const [key, english] of Object.entries(source)) {
    const match = key.match(PLURAL_SUFFIX);
    const base = match ? key.slice(0, -match[0].length) : null;
    if (!base || source[`${base}_other`] === undefined) {
      entries.push({ key, english, plural: null });
      continue;
    }
    if (done.has(base)) continue;
    done.add(base);
    for (const category of pluralCategories(locale)) {
      entries.push({ key: `${base}_${category}`, english: source[`${base}_${category}`] ?? source[`${base}_other`], plural: category });
    }
  }
  return entries;
}

function sorted(items: Iterable<string>): string[] {
  return [...new Set(items)].sort();
}

export function placeholdersOf(text: string): string[] {
  return sorted([...text.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map((m) => m[1]));
}

/** <terms>...</terms> in a string used with Trans. */
export function tagsOf(text: string): string[] {
  return [...text.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)>/g)].map((m) => m[0]).sort();
}

/** Null when the translation keeps what it must, otherwise what is wrong. */
export function translationProblem(entry: TargetEntry, text: string): string | null {
  if (!text.trim()) return 'empty';
  const wanted = placeholdersOf(entry.english).filter((name) => !(name === 'count' && entry.plural && entry.plural !== 'other'));
  const got = placeholdersOf(text);
  const allowed = placeholdersOf(entry.english);
  const missing = wanted.filter((name) => !got.includes(name));
  const extra = got.filter((name) => !allowed.includes(name));
  if (missing.length > 0) return `missing placeholder ${missing.join(', ')}`;
  if (extra.length > 0) return `unknown placeholder ${extra.join(', ')}`;
  if (tagsOf(entry.english).join() !== tagsOf(text).join()) return 'tags do not match';
  return null;
}

const INDEX_HEAD = `// Generated by scripts/translate-locales.ts. Do not edit.
// A static list so the bundler sees every file. Each one loads only when its language is first used.
type Strings = Record<string, unknown>;

export const GENERATED_LOCALES: Record<string, () => Strings> = {
`;

export function indexText(codes: string[]): string {
  return `${INDEX_HEAD}${codes.map((code) => `  '${code}': () => require('./${code}.json') as Strings,\n`).join('')}};\n`;
}

export function presentLocales(): string[] {
  return readLocales()
    .map((language) => language.code)
    .filter((code) => existsSync(join(GENERATED, `${code}.json`)));
}

export function writeIndex(): void {
  mkdirSync(GENERATED, { recursive: true });
  writeFileSync(join(GENERATED, 'index.ts'), indexText(presentLocales()));
}
