import { spawnSync } from 'node:child_process';

const port = process.env.PORT || '4173';

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', 'preview', '--host', '0.0.0.0', '--port', port],
  { stdio: 'inherit', shell: true }
);

process.exit(result.status ?? 1);
