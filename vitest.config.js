import { defineConfig } from 'vitest/config'

// Test harness for the dashboard. Unit tests run in the node environment
// (pure logic — catalog, metrics, TTV/stage derivation). Component tests can
// opt into jsdom per-file with `// @vitest-environment jsdom`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    globals: true,
    // Small, fast unit suite — run in a single fork without isolation to avoid
    // the worker module-server roundtrip (and it's quicker for pure-logic tests).
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    isolate: false,
  },
})
