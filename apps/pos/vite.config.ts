import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served under /pos/ so the launcher (port 5170) can proxy every web app onto one origin.
// One origin = one shared simulated-cloud IndexedDB + live BroadcastChannel updates.
// Tauri production builds load from the bundled dist, so assets must be relative ('./').
export default defineConfig({
  base: process.env.TAURI_ENV_PLATFORM ? './' : '/pos/',
  plugins: [react()],
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  server: { port: 5173, strictPort: true, hmr: { clientPort: 5170 } },
  clearScreen: false,
});
