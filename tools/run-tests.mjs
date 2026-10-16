// Bundles every tests/*.test.ts with esbuild (aliasing @minecraft/server to the mock world)
// and runs them with node:test.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = path.join(root, 'build', 'tests');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const filter = process.argv[2];
const files = fs.readdirSync(path.join(root, 'tests')).filter((f) => f.endsWith('.test.ts') && (!filter || f.includes(filter)));
for (const f of files) {
  await build({
    entryPoints: [path.join(root, 'tests', f)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    outfile: path.join(outDir, f.replace(/\.ts$/, '.mjs')),
    alias: {
      '@minecraft/server': path.join(root, 'tests', 'mock', 'server.ts'),
      '@minecraft/server-ui': path.join(root, 'tests', 'mock', 'server-ui.ts'),
    },
    logLevel: 'error',
  });
}
const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files.map((f) => path.join(outDir, f.replace(/\.ts$/, '.mjs')))], { stdio: 'inherit' });
process.exit(r.status ?? 1);
