import { spawn } from 'node:child_process';
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const buildDir = path.join(rootDir, 'build');
const distDir = path.join(rootDir, 'dist');
const bundledScript = path.join(buildDir, 'muxin-video-downloader.cjs');
const seaBlob = path.join(buildDir, 'muxin-video-downloader.blob');
const seaConfig = path.join(buildDir, 'sea-config.json');
const exePath = path.join(distDir, 'muxin-video-downloader.exe');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

await rm(buildDir, { recursive: true, force: true });
await mkdir(buildDir, { recursive: true });
await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [path.join(rootDir, 'src', 'main.mjs')],
  outfile: bundledScript,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
});

await writeFile(seaConfig, JSON.stringify({
  main: path.relative(rootDir, bundledScript).replaceAll(path.sep, '/'),
  output: path.relative(rootDir, seaBlob).replaceAll(path.sep, '/'),
  disableExperimentalSEAWarning: true,
}, null, 2));

await run(process.execPath, ['--experimental-sea-config', seaConfig]);
await copyFile(process.execPath, exePath);

const postjectCli = path.join(rootDir, 'node_modules', 'postject', 'dist', 'cli.js');

await run(process.execPath, [
  postjectCli,
  exePath,
  'NODE_SEA_BLOB',
  seaBlob,
  '--sentinel-fuse',
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  '--overwrite',
]);

const output = await stat(exePath);
console.log(`\nCreated ${exePath}`);
console.log(`Size: ${output.size} bytes`);
