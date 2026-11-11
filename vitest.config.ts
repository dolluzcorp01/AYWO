import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@aywo/shared': src('shared'),
      '@aywo/kinship': src('kinship'),
      '@aywo/lighten': src('lighten'),
      '@aywo/layout': src('layout'),
    },
  },
  // App logic with no React Native imports (such as src/tree/familyGaps.ts) is tested here too.
  test: { include: ['packages/*/src/**/*.test.ts', 'apps/app/src/**/*.test.ts'] },
});
