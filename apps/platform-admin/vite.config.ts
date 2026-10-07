import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served under /admin/ so the launcher (port 5170) can proxy every web app onto one origin.
// One origin = one shared simulated-cloud IndexedDB + live BroadcastChannel updates.
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: { port: 5175, strictPort: true, hmr: { clientPort: 5170 } },
  clearScreen: false,
});
