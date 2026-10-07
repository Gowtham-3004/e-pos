import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = (port: number) => ({ target: `http://localhost:${port}`, changeOrigin: true, ws: true });

// Single origin for every web product → shared simulated cloud (IndexedDB) + live cross-app updates.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5170,
    strictPort: true,
    proxy: {
      '/pos': target(5173),
      '/backoffice': target(5174),
      '/admin': target(5175),
    },
  },
  clearScreen: false,
});
