import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin API in development so the auth cookie and PDF iframes just work.
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API || 'http://127.0.0.1:4000',
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on('error', (_error, _request, response) => {
            if (response.headersSent || response.destroyed) return;
            response.writeHead(502, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({
              error: {
                code: 'API_UNAVAILABLE',
                message: 'The API is unavailable. Start it in a separate terminal with `cd server` and `npm run dev`.',
              },
            }));
          });
        },
      },
    },
  },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.js'], globals: true },
});
