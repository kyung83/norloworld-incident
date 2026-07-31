// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// Served from GitHub Pages under /norloworld-incident/. Routing is hash-based
// (HashRouter), so the base only needs the repo subpath.
export default defineConfig({
  plugins: [react()],
  base: '/norloworld-incident/',
})
