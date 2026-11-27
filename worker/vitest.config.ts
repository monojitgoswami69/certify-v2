import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    dedupe: ['@neondatabase/serverless'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 90_000,
    hookTimeout: 60_000,
  },
});
