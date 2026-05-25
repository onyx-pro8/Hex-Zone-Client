import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
    allowedHosts: ['hex-zone-client.onrender.com']
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: ['hex-zone-client.onrender.com']
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: 'src/setupTests.ts'
  }
});
