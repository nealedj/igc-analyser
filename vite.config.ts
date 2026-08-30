import { defineConfig } from 'vite';

/**
 * `base` comes from the environment so one build can be served from a domain
 * root or from a subpath without changing anything in the source. Assets are
 * emitted relative to it, never as absolute paths.
 */
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'es2022',
    sourcemap: true,
  },
});
