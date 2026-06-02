import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['json', 'json-summary', 'lcov', 'text', 'clover'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['**/__tests__/**', '**/tests/**', 'src/bin.ts'],
      reportsDirectory: 'coverage',
      thresholds: { lines: 90, statements: 90, functions: 90, perFile: false },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.{spec,test}.ts'],
          globals: true,
          environment: 'node',
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.{spec,test}.ts'],
          globals: true,
          environment: 'node',
          globalSetup: ['./tests/vitest.global-setup.ts'],
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
