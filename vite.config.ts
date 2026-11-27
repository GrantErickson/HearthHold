import { defineConfig } from 'vite';

// `base: './'` keeps asset paths relative so the built `dist/` folder works
// from any sub-path (GitHub Pages project sites, a sub-folder on a server, …).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
