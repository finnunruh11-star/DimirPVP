import { defineConfig } from 'vite';

export default defineConfig({
  // `host` exposes the servers on the LAN so a phone can load them for testing.
  server: { open: true, host: true },
  preview: { host: true },
  build: { target: 'es2020' }
});
