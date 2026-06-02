import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Vercel waits for the Node process to exit; Vitest-in-Vite can leave handles open. */
function forceExitAfterBuild(): Plugin {
  return {
    name: 'force-exit-after-build',
    apply: 'build',
    closeBundle() {
      if (process.env.VERCEL || process.env.CI) {
        setTimeout(() => process.exit(0), 0);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), forceExitAfterBuild()],
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('leaflet') || id.includes('react-leaflet')) return 'maps';
          if (id.includes('@turf') || id.includes('h3-js')) return 'geo';
          if (
            id.includes('react-dom') ||
            id.includes('react-router') ||
            /[/\\]react[/\\]/.test(id)
          ) {
            return 'react-vendor';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
