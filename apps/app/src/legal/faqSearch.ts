// Finds the questions that fit what someone typed in the FAQ search box.
// It looks at the question, its answer and a list of extra words people use for the same thing
// ("money back" for a refund), forgives a small typing mistake, and puts the best fit first.

export type FaqEntry = { key: string; question: string; answer: string; keywords: string };

// Small words that say nothing about the subject. They are ignored unless the search is only made of them.
const FILLER = new Set([
  'a', 'an', 'the', 'i', 'my', 'me', 'we', 'you', 'your', 'it', 'is', 'are', 'am', 'was', 'be', 'do', 'does', 'did', 'can', 'could',
  'will', 'would', 'should', 'how', 'what', 'where', 'when', 'why', 'who', 'which', 'to', 'of', 'in', 'on', 'for', 'from', 'with',
  'and', 'or', 'but', 'not', 'no', 'have', 'has', 'get', 'this', 'that', 'there', 'if', 'so', 'at', 'by', 'as', 'please',
]);

/** Lower case, split into words. Keeps letters, numbers and the marks that join to letters (needed for Tamil). */
export function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
}

/** True when the two words differ by at most `limit` typing mistakes (a wrong, missing, extra or swapped letter). */
function near(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) return false;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > limit) return false;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length] <= limit;
}

// How well one typed word fits one word of the text: 3 the same, 2 the start of it, 1 nearly the same, 0 no fit.
function fit(typed: string, word: string): number {
  if (typed === word) return 3;
  if (typed.length >= 2 && word.startsWith(typed)) return 2;
  // Short words are not guessed at: "pay" must not match "day".
  const limit = typed.length >= 8 ? 2 : typed.length >= 4 ? 1 : 0;
  if (limit && near(typed, word, limit)) return 1;
  return 0;
}

function bestFit(typed: string, list: string[]): number {
  let best = 0;
  for (const word of list) {
    const f = fit(typed, word);
    if (f > best) best = f;
    if (best === 3) break;
  }
  return best;
}

/** The entries that fit the search, best first. An empty search gives an empty list. */
export function searchFaq(entries: FaqEntry[], search: string, limit = 8): FaqEntry[] {
  const all = words(search);
  const useful = all.filter((w) => !FILLER.has(w));
  const typed = useful.length ? useful : all;
  if (!typed.length) return [];

  const scored: { entry: FaqEntry; hits: number; score: number }[] = [];
  for (const entry of entries) {
    const inQuestion = words(entry.question);
    const inKeywords = words(entry.keywords);
    const inAnswer = words(entry.answer);
    let hits = 0;
    let score = 0;
    for (const word of typed) {
      // A word in the question or the extra words counts for more than the same word deep in the answer.
      const strong = Math.max(bestFit(word, inQuestion), bestFit(word, inKeywords)) * 3;
      const answer = bestFit(word, inAnswer);
      // A near-miss in a long answer is too often chance, so only a real match there counts.
      const weak = answer >= 2 ? answer : 0;
      const got = Math.max(strong, weak);
      if (got > 0) hits += 1;
      score += got;
    }
    if (hits > 0) scored.push({ entry, hits, score });
  }
  // More of the typed words found comes first; then the stronger fit.
  scored.sort((a, b) => b.hits - a.hits || b.score - a.score);
  // When some question fits every typed word, the ones that fit only a part of it are noise.
  const top = scored[0]?.hits ?? 0;
  const kept = top === typed.length ? scored.filter((s) => s.hits === top || s.score >= scored[0].score) : scored;
  return kept.slice(0, limit).map((s) => s.entry);
}
