import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Run test files one at a time.
    // Integration tests share a single PostgreSQL database, so running files
    // in parallel causes lock contention: admin.test.ts TRUNCATE (afterEach)
    // blocks proxy.test.ts INSERT (beforeAll) and vice-versa, making every
    // app.inject() hang for the full 30 s testTimeout.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['dist/', 'node_modules/', 'tests/', 'scripts/'],
    },
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
