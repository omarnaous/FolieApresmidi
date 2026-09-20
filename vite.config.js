import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Worker (wrangler dev, :8787) owns everything dynamic: the API, the
// image pipeline, and the server-rendered heads for product and collection
// pages. In development Vite serves the app on :5173 and forwards those
// paths, so the browser sees one origin — the same shape as production,
// where one Worker serves both.
// 127.0.0.1, not localhost: Node may resolve localhost to ::1 while wrangler
// listens on IPv4, which shows up as a 502 from the proxy.
const WORKER = 'http://127.0.0.1:8787'
const forward = { target: WORKER, changeOrigin: false, xfwd: true }

export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    port: 5173,
    open: false,
    proxy: {
      '/api': forward,
      // uploaded/imported images live in R2 behind the Worker; /media/ig/* are static files
      '^/media/(products|brand)/': forward,
      '/sitemap.xml': forward,
      '/robots.txt': forward,
      '/cart/recover': forward,
      '/unsubscribe': forward,
    },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        // keep the admin out of the storefront's first load
        manualChunks: (id) => (id.includes('/src/admin/') ? 'admin' : undefined),
      },
    },
  },
})
