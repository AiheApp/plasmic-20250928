import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Use relative-root base so asset URLs are emitted as `/assets/...` instead
  // of being absolutely pinned to the build-time HOST_URL. This lets the
  // host iframe be loaded over either HTTP (port 3005) or HTTPS (Traefik
  // subdomain) without mixed-content failures.
  base: '/',
  server: {
    host: '0.0.0.0',
    port: 3000,
    cors: true
  },
  build: {
    outDir: 'dist'
  }
})
