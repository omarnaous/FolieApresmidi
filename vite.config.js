import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served from https://omarnaous.github.io/FolieApresmidi/ — a project page,
// so the build needs that subpath. Dev keeps '/' so localhost is unaffected.
// Paths written by hand (public/media/*) are built off import.meta.env.BASE_URL
// in src/data/assets.js; Vite does not rewrite those on its own.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/FolieApresmidi/' : '/',
  plugins: [react()],
  server: { port: 5173, open: false },
}))
