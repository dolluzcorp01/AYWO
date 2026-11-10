// LLD L12: makes locales/generated/<locale>.json for the 63 locales in db/seed/languages.sql, and the index the app loads.
// English comes from the area files. Tamil's hand-written draft is kept and only missing keys are translated.
// Run again at any time: only new or changed English strings are sent.
//
//   pnpm locales:translate                 all locales
//   pnpm locales:translate --only=hi,ta    just these
//   pnpm locales:translate --index-only    rewrite the index, no AI
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import {
  GENERATED,
  readAreaFiles,
  readGenerated,
  readLocales,
  SOURCE_LOCALE,
  targetEntries,
  translationProblem,
  writeGenerated,
  writeIndex,
} from './locale-lib.ts';
import type { Flat, SeedLanguage, TargetEntry } from './locale-lib.ts';

const MODEL = 'claude-sonnet-5-5';
const BATCH = 120;
const ROUNDS = 3;
const LOCALES_AT_ONCE = 4;
const SOURCES = join(GENERATED, '.sources');

const SYSTEM = `You translate the interface of AYWO ("Across Years, We're One"), a family-tree app used by people of all ages, including elders who are not used to phones.

Rules:
- Plain, warm, everyday words, as a relative would say them. Never stiff or official, except in the legal pages (keys under legal.), which stay accurate and clear.
- Keep every {{placeholder}} exactly as written, including its name. Move it wherever the grammar needs it. Never translate what is inside the braces.
- Keep tags such as <terms> and </terms> exactly, around the words they belong to.
- Never guess someone's gender: avoid he, she, his and her. Use the person's name, a neutral form, or rework the sentence.
- Tree roles are Viewer, Commenter, Editor, Co-creator and Creator. Translate each one consistently, and never as "owner" or "admin". "AYWO Admin" and "Sub-admin" are the app's own staff.
- Keep these as they are: AYWO, AYWO Plus, SOS, GEDCOM, PDF, WhatsApp, Apple, Google, Razorpay, Stripe, UPI and other brand names.
- Keep \\n line breaks.
- Write in the requested language and script only, for that region. Do not transliterate into another script.
- An item with a "plural" field is one form of a plural, used for that plural category of the language. Write the form that fits. {{count}} may be left out only where the language's "one" form does not need it.

Answer with every key you were given, and the translation as its value.`;

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, value: { type: 'string' } },
        required: ['key', 'value'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

function targetLine(language: SeedLanguage): string {
  const direction = language.rtl ? ' It reads right to left.' : '';
  if (language.code.startsWith('en-')) {
    return `Language: ${language.name} (${language.code}). The text is American English. Change only the spelling and words that differ for this region, and leave the rest alone.`;
  }
  return `Language: ${language.name} (${language.code}), written in ${language.script} script.${direction}`;
}

async function translateBatch(client: Anthropic, language: SeedLanguage, items: TargetEntry[]): Promise<Flat> {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: ANSWER_SCHEMA } },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: `${targetLine(language)}\n\nTranslate:\n${JSON.stringify(
          items.map((item) => ({ key: item.key, english: item.english, ...(item.plural ? { plural: item.plural } : {}) })),
          null,
          1,
        )}`,
      },
    ],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason !== 'end_turn') throw new Error(`stopped early: ${message.stop_reason}`);
  const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
  const answer = JSON.parse(text) as { items: { key: string; value: string }[] };
  return Object.fromEntries(answer.items.map((item) => [item.key, item.value]));
}

function readSeen(locale: string): Flat {
  const path = join(SOURCES, `${locale}.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Flat) : {};
}

function writeSeen(locale: string, seen: Flat): void {
  mkdirSync(SOURCES, { recursive: true });
  writeFileSync(join(SOURCES, `${locale}.json`), `${JSON.stringify(seen, null, 1)}\n`);
}

/** The file's keys in the source's order, so a run changes as few lines as it can. */
function inOrder(entries: TargetEntry[], texts: Flat): Flat {
  return Object.fromEntries(entries.flatMap((entry) => (texts[entry.key] === undefined ? [] : [[entry.key, texts[entry.key]]])));
}

async function translateLocale(client: Anthropic, language: SeedLanguage, source: Flat): Promise<number> {
  const locale = language.code;
  if (locale === SOURCE_LOCALE) {
    writeGenerated(locale, source);
    return 0;
  }
  const entries = targetEntries(source, locale);
  const handWritten = locale === 'ta' ? readAreaFiles('ta') : {};
  const texts: Flat = { ...readGenerated(locale), ...handWritten };
  const seen = readSeen(locale);

  // Anything new, changed in English, or broken gets translated. Hand-written words are never replaced.
  let waiting = entries.filter(
    (entry) =>
      handWritten[entry.key] === undefined &&
      (texts[entry.key] === undefined || seen[entry.key] !== entry.english || translationProblem(entry, texts[entry.key]) !== null),
  );

  for (let round = 0; round < ROUNDS && waiting.length > 0; round += 1) {
    const stillWaiting: TargetEntry[] = [];
    for (let at = 0; at < waiting.length; at += BATCH) {
      const items = waiting.slice(at, at + BATCH);
      let answer: Flat = {};
      try {
        answer = await translateBatch(client, language, items);
      } catch (error) {
        if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw error;
        console.warn(`${locale}: this batch failed and will be tried again: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
      for (const item of items) {
        const text = answer[item.key];
        const problem = text === undefined ? 'no answer' : translationProblem(item, text);
        if (problem) {
          stillWaiting.push(item);
        } else {
          texts[item.key] = text;
          seen[item.key] = item.english;
        }
      }
      // Saved after every batch, so a stopped run carries on where it left off.
      writeGenerated(locale, inOrder(entries, texts));
      writeSeen(locale, seen);
    }
    waiting = stillWaiting;
  }

  writeGenerated(locale, inOrder(entries, texts));
  writeSeen(locale, seen);
  for (const item of waiting) console.error(`${locale}: gave up on ${item.key}`);
  console.info(`${locale}: done, ${entries.length - waiting.length} of ${entries.length}`);
  return waiting.length;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--index-only')) {
    writeIndex();
    return;
  }
  const only = args.find((arg) => arg.startsWith('--only='))?.slice('--only='.length).split(',');
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === 'dummy') {
    throw new Error('Set a real ANTHROPIC_API_KEY in .env first.');
  }
  const client = new Anthropic({ apiKey: key });
  const source = readAreaFiles(SOURCE_LOCALE);
  const queue = readLocales().filter((language) => !only || only.includes(language.code));

  let failed = 0;
  async function worker(): Promise<void> {
    for (let next = queue.shift(); next; next = queue.shift()) failed += await translateLocale(client, next, source);
  }
  await Promise.all(Array.from({ length: LOCALES_AT_ONCE }, () => worker()));

  writeIndex();
  if (failed > 0) {
    console.error(`${failed} strings could not be translated. Run this again, then pnpm locales:check.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
