import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Two homes, two base paths.
//
//   Cloudflare Workers  served at the domain root, and the only build with
//                       an API behind it — this is the default
//   GitHub Pages        a project page, so it needs the /FolieApresmidi/
//                       subpath; scripts/deploy.sh sets SITE_BASE for it
//
// Paths written by hand (public/media/*) are built off import.meta.env.BASE_URL
// in src/data/assets.js; Vite does not rewrite those on its own.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.SITE_BASE ?? '/') : '/',
  plugins: [react()],
  server: { port: 5173, open: false },
}))
