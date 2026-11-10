// T-IO-01 against the founder's real file. The file is never committed: set AYWO_LIGHTEN_SAMPLE to run this.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readLightenZip } from './zip.ts';

const path = process.env.AYWO_LIGHTEN_SAMPLE;

describe.skipIf(!path)('T-IO-01: real Lighten file', () => {
  it('reads the counts agreed in the LLD', () => {
    const preview = readLightenZip(new Uint8Array(readFileSync(path ?? '')));
    expect(preview.counts.topics).toBe(33);
    expect(preview.counts.couplesSplit).toBe(8);
    expect(preview.counts.merges).toBe(2);
    expect(preview.counts.people).toBe(38);
    expect(preview.placeholders.length).toBe(1);
    expect(preview.problems).toEqual([]);
  });
});
