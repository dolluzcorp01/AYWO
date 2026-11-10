// Run before going live: pnpm legal:check. Exits 1 while a placeholder or the draft notice is left on the public pages.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './locale-lib.ts';

const text = readFileSync(join(ROOT, 'apps', 'app', 'src', 'legal', 'publisher.ts'), 'utf8');
const problems = [...text.matchAll(/^\s*(\w+): 'XXX'/gm)].map((match) => `${match[1]} is still XXX`);
if (/LEGAL_DRAFT = true/.test(text)) problems.push('LEGAL_DRAFT is still true');

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`${problems.length} things to finish in apps/app/src/legal/publisher.ts.`);
  process.exit(1);
}
console.info('Public pages are ready to go live.');
