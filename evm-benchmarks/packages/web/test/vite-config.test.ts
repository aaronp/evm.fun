import { expect, test } from 'bun:test'
import config from '../vite.config'

// Regression: if revm-wasm is pre-bundled, its wasm-url.js moves to node_modules/.vite/deps
// and the computed wasm URL 404s into index.html on the dev server.
test('revm-wasm is excluded from optimizeDeps', () => {
  expect(config.optimizeDeps?.exclude).toContain('revm-wasm')
})
