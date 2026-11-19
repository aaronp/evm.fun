import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: './', // relative asset URLs: works from any static path
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  build: { outDir: 'dist', target: 'es2022' },
})
