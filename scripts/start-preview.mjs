import { preview } from 'vite';

const port = Number(process.env.PORT) || 4173;

try {
  const server = await preview({
    preview: {
      port,
      host: '0.0.0.0',
      strictPort: true,
      allowedHosts: true,
    },
    logLevel: 'info',
  });

  server.printUrls();

  const onShutdown = () => {
    server.httpServer?.close(() => process.exit(0));
  };
  process.on('SIGTERM', onShutdown);
  process.on('SIGINT', onShutdown);
} catch (err) {
  console.error('[start] Failed to start preview server:', err);
  process.exit(1);
}
