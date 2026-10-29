import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development, the browser talks to Vite on port 5173. Vite forwards /api calls to the backend on port 4000.
// This keeps the session cookie on one origin, so it works without extra setup.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Stop with an error if port 5173 is busy. Without this, Vite silently moves to 5174,
    // and the backend then refuses requests from that address.
    strictPort: true,
    proxy: {
      // API_TARGET lets a second copy of the site talk to a test backend; normally it is port 4000.
      '/api': process.env.API_TARGET ?? 'http://localhost:4000',
    },
  },
});
