import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Swagger-UI plugin reads static files during app.ready() which can be
    // slow on cold CI runners. Integration tests also connect to real
    // Postgres + Redis, adding further startup latency.
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
