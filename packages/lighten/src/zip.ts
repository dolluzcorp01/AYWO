import { strFromU8, unzipSync } from 'fflate';
import { parseLighten } from './parse.ts';
import type { ImportPreview, LightenContent } from './parse.ts';

const MAX_CONTENT_BYTES = 5_000_000;

/** Each .lighten.zip holds <name>.lighten/content.json (LLD L8.2). Nothing else is unpacked, and never a huge file. */
export function readLightenZip(bytes: Uint8Array): ImportPreview {
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (!file.name.endsWith('content.json')) return false;
      if (file.originalSize > MAX_CONTENT_BYTES) throw new Error('import.lighten.too_large');
      return true;
    },
  });
  const name = Object.keys(files).find((f) => f.endsWith('content.json'));
  if (!name) throw new Error('import.lighten.no_content');
  const content: LightenContent = JSON.parse(strFromU8(files[name]));
  return parseLighten(content);
}
