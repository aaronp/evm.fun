import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  // As packages/web: pre-bundling breaks revm-wasm's new URL('../wasm/revm.wasm', import.meta.url).
  optimizeDeps: { exclude: ['revm-wasm'] },
  worker: { format: 'es' },
  build: { outDir: 'dist', target: 'es2022' },
})
