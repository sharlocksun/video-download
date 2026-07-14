import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const buildDir = path.join(root, 'build', 'macos');
const bundledScript = path.join(buildDir, 'muxin-video-downloader.cjs');
const seaBlob = path.join(buildDir, 'muxin-video-downloader.blob');
const seaConfig = path.join(buildDir, 'sea-config.json');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd: root, stdio: 'inherit' });
    proc.on('error', reject);
    proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

await rm(buildDir, { recursive: true, force: true });
await mkdir(buildDir, { recursive: true });
await build({
  entryPoints: [path.join(root, 'src', 'main.mjs')],
  outfile: bundledScript,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
});
await writeFile(seaConfig, JSON.stringify({
  main: path.relative(root, bundledScript).replaceAll(path.sep, '/'),
  output: path.relative(root, seaBlob).replaceAll(path.sep, '/'),
  disableExperimentalSEAWarning: true,
}, null, 2));
await run(process.execPath, ['--experimental-sea-config', seaConfig]);
console.log(seaBlob);
