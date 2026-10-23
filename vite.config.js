import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths so the same build works on any web host and inside the Android app.
  base: './',
  server: { host: true, port: 5173 },
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
});
