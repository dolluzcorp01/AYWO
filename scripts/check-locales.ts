// LLD L12: every key in every file, with its placeholders intact. Exits 1 on any problem.
//   pnpm locales:check             every locale in db/seed/languages.sql must have its file
//   pnpm locales:check --present   only the files that exist so far, for before the first translation run
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GENERATED,
  indexText,
  placeholdersOf,
  presentLocales,
  readAreaFiles,
  readGenerated,
  readLocales,
  SOURCE_LOCALE,
  targetEntries,
  translationProblem,
} from './locale-lib.ts';
import type { Flat } from './locale-lib.ts';

const problems: string[] = [];
const source = readAreaFiles(SOURCE_LOCALE);

function checkTexts(locale: string, texts: Flat): void {
  const entries = targetEntries(source, locale);
  const wanted = new Set(entries.map((entry) => entry.key));
  for (const entry of entries) {
    const text = texts[entry.key];
    if (text === undefined) {
      problems.push(`${locale}: missing ${entry.key}`);
      continue;
    }
    const problem = translationProblem(entry, text);
    if (problem) problems.push(`${locale}: ${entry.key}: ${problem}`);
  }
  for (const key of Object.keys(texts)) {
    // Extra plural forms are harmless: i18next simply never picks them.
    if (!wanted.has(key) && !/_(zero|one|two|few|many)$/.test(key)) problems.push(`${locale}: no longer in English: ${key}`);
  }
}

const present = presentLocales();
if (!process.argv.includes('--present')) {
  for (const language of readLocales()) {
    if (!present.includes(language.code)) problems.push(`${language.code}: no file (run pnpm locales:translate)`);
  }
}
for (const locale of present) checkTexts(locale, readGenerated(locale));

// The hand-written Tamil is what the app shows on top of its generated file.
const tamil = readAreaFiles('ta');
for (const [key, english] of Object.entries(source)) {
  const text = tamil[key];
  if (text !== undefined && placeholdersOf(text).some((name) => !placeholdersOf(english).includes(name))) {
    problems.push(`ta (hand-written): ${key}: unknown placeholder`);
  }
}

const index = readFileSync(join(GENERATED, 'index.ts'), 'utf8');
if (index !== indexText(present)) problems.push('locales/generated/index.ts is out of date (run pnpm locales:translate --index-only)');

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`${problems.length} problems.`);
  process.exit(1);
}
console.info(`${present.length} locales checked against ${Object.keys(source).length} English strings.`);
