import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: process.env.GALLEY_CONTRACTS === '1'
      ? ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'tests/contracts/**/*.test.ts']
      : ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
  },
});
