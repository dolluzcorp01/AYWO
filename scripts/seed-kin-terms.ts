// LLD L6.3: asks the AI for the relationship words of each (path, language) pair and writes db/seed/kin_terms/<lang>.sql,
// status ai_seeded until someone has checked them. pnpm migrate --seed loads everything in that folder.
//
//   pnpm kin:seed                 every language that has no file yet
//   pnpm kin:seed --only=hi,te    just these
//   pnpm kin:seed --only=hi --force    write over an existing file
// en and ta are checked by hand, and the English variants share en, so they are skipped unless named with --only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { readLanguages, ROOT } from './locale-lib.ts';
import type { SeedLanguage } from './locale-lib.ts';

const MODEL = 'claude-sonnet-5-5';
const BATCH = 40;
const ROUNDS = 3;
const LANGUAGES_AT_ONCE = 3;
const OUT = join(ROOT, 'db', 'seed', 'kin_terms');

interface KinPath {
  code: string;
  description: string;
}

interface Word {
  path_code: string;
  term: string;
  term_native: string | null;
  speaker_gender: 'male' | 'female' | null;
  is_default: boolean;
}

const SYSTEM = `You write the dictionary of family relationship words for AYWO, a family-tree app. Give the word a person really says for each relationship, in everyday family speech.

A path code describes the relative, read from left to right starting at the speaker:
F father, M mother, S son, D daughter, B brother, Z sister, H husband, W wife.
"+" after a sibling letter: elder than the person before it. "-": younger. No sign: the language does not need the order, or it is not known.
"h": half-sibling. "~": step-relation.
Examples: F.B+ is father's elder brother (Tamil: Periyappa). F.B- is father's younger brother (Chithappa). M.B is mother's brother (Mama). M.M is mother's mother. F.Z.S is father's sister's son.

Rules for each path:
- term: the word in Latin letters, as people would type it. Required.
- term_native: the same word in the language's own script. Null only if the language is written in Latin letters.
- speaker_gender: null when anyone says the same word. "male" or "female" only when the word really changes with the speaker's gender, and then give one entry for each speaker.
- is_default: true for the most common word. Exactly one default for each path and speaker. Add other common words as extra entries with is_default false, at most two.
- If the language uses one word regardless of elder or younger, give that same word for the path with + and with -.
- If a path has no word of its own, give the phrase people would really say.
- Use the given language, script and region only. Do not invent words: for a language with little written record, give the most widely understood form.`;

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    words: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path_code: { type: 'string' },
          term: { type: 'string' },
          term_native: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          speaker_gender: { anyOf: [{ type: 'string', enum: ['male', 'female'] }, { type: 'null' }] },
          is_default: { type: 'boolean' },
        },
        required: ['path_code', 'term', 'term_native', 'speaker_gender', 'is_default'],
        additionalProperties: false,
      },
    },
  },
  required: ['words'],
  additionalProperties: false,
};

function readPaths(): KinPath[] {
  const sql = readFileSync(join(ROOT, 'db', 'seed', 'kin_paths.sql'), 'utf8');
  return [...sql.matchAll(/^\s*\('([^']+)', '((?:[^']|'')+)', -?\d+, (?:true|false)\)/gm)].map((row) => ({
    code: row[1],
    description: row[2].replace(/''/g, "'"),
  }));
}

async function askBatch(client: Anthropic, language: SeedLanguage, paths: KinPath[]): Promise<Word[]> {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high', format: { type: 'json_schema', schema: ANSWER_SCHEMA } },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: `Language: ${language.name} (${language.code}), written in ${language.script} script.\n\nPaths:\n${paths
          .map((path) => `${path.code}: ${path.description}`)
          .join('\n')}`,
      },
    ],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason !== 'end_turn') throw new Error(`stopped early: ${message.stop_reason}`);
  const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
  return (JSON.parse(text) as { words: Word[] }).words;
}

function sqlText(text: string | null): string {
  return text === null ? 'null' : `'${text.replace(/'/g, "''")}'`;
}

/** Exactly one default for each path and speaker, whatever came back, and no word twice. */
function tidy(words: Word[], known: Set<string>): Word[] {
  const seen = new Set<string>();
  const defaults = new Set<string>();
  const clean: Word[] = [];
  for (const word of words) {
    const term = word.term.trim();
    if (!term || !known.has(word.path_code)) continue;
    const key = `${word.path_code}|${term.toLowerCase()}|${word.speaker_gender}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push({ ...word, term, term_native: word.term_native?.trim() || null });
  }
  for (const word of clean) {
    const slot = `${word.path_code}|${word.speaker_gender}`;
    if (word.is_default && !defaults.has(slot)) defaults.add(slot);
    else word.is_default = false;
  }
  for (const word of clean) {
    const slot = `${word.path_code}|${word.speaker_gender}`;
    if (!defaults.has(slot)) {
      defaults.add(slot);
      word.is_default = true;
    }
  }
  return clean;
}

async function seedLanguage(client: Anthropic, language: SeedLanguage, paths: KinPath[]): Promise<void> {
  const known = new Set(paths.map((path) => path.code));
  const words: Word[] = [];
  let waiting = paths;
  for (let round = 0; round < ROUNDS && waiting.length > 0; round += 1) {
    for (let at = 0; at < waiting.length; at += BATCH) {
      try {
        words.push(...(await askBatch(client, language, waiting.slice(at, at + BATCH))));
      } catch (error) {
        if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw error;
        console.warn(`${language.code}: this batch failed and will be tried again: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
    const answered = new Set(words.map((word) => word.path_code));
    waiting = paths.filter((path) => !answered.has(path.code));
  }
  const clean = tidy(words, known);
  if (clean.length === 0) throw new Error(`${language.code}: no words came back`);
  const rows = clean.map(
    (word) =>
      `  (${sqlText(word.path_code)}, ${sqlText(language.code)}, ${sqlText(word.term)}, ${sqlText(word.term_native)}, ${sqlText(word.speaker_gender)}, ${word.is_default}, 'ai_seeded')`,
  );
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, `${language.code}.sql`),
    `-- Generated by scripts/seed-kin-terms.ts. Status ai_seeded until someone has checked the words.\ninsert into kin_terms (path_code, language_code, term, term_native, speaker_gender, is_default, status) values\n${rows.join(',\n')}\non conflict do nothing;\n`,
  );
  for (const path of waiting) console.error(`${language.code}: no word for ${path.code}, so the app will build a phrase`);
  console.info(`${language.code}: ${clean.length} words for ${paths.length - waiting.length} of ${paths.length} paths`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const only = args.find((arg) => arg.startsWith('--only='))?.slice('--only='.length).split(',');
  const force = args.includes('--force');
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === 'dummy') {
    throw new Error('Set a real ANTHROPIC_API_KEY in .env first.');
  }
  const client = new Anthropic({ apiKey: key });
  const paths = readPaths();
  const queue = readLanguages().filter((language) => {
    if (only) return only.includes(language.code) && (force || !existsSync(join(OUT, `${language.code}.sql`)));
    if (language.code === 'en' || language.code.startsWith('en-') || language.code === 'ta') return false;
    return force || !existsSync(join(OUT, `${language.code}.sql`));
  });

  async function worker(): Promise<void> {
    for (let next = queue.shift(); next; next = queue.shift()) await seedLanguage(client, next, paths);
  }
  await Promise.all(Array.from({ length: LANGUAGES_AT_ONCE }, () => worker()));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
