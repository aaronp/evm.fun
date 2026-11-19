import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: './', // relative asset URLs: works from any static path
  plugins: [react(), tailwindcss()],
  // Pre-bundling copies revm-wasm/wasm-url.js into node_modules/.vite/deps, breaking its
  // new URL('../wasm/revm.wasm', import.meta.url) (dev server then serves index.html).
  optimizeDeps: { exclude: ['revm-wasm'] },
  worker: { format: 'es' },
  build: { outDir: 'dist', target: 'es2022' },
})
