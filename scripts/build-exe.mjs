import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { rcedit } from 'rcedit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const buildDir = path.join(rootDir, 'build');
const distDir = path.join(rootDir, 'dist');
const bundledScript = path.join(buildDir, 'muxin-video-downloader.cjs');
const seaBlob = path.join(buildDir, 'muxin-video-downloader.blob');
const seaConfig = path.join(buildDir, 'sea-config.json');
const exePath = path.join(distDir, 'muxin-video-downloader.exe');
const iconPath = path.join(rootDir, 'assets', 'app-icon', 'app-icon.ico');

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

async function removeAuthenticodeSignature(filePath) {
  const executable = await readFile(filePath);
  const peOffset = executable.readUInt32LE(0x3c);
  if (executable.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error(`Invalid PE executable: ${filePath}`);
  }

  const optionalHeaderOffset = peOffset + 24;
  const optionalHeaderMagic = executable.readUInt16LE(optionalHeaderOffset);
  const dataDirectoryOffset = optionalHeaderOffset + (optionalHeaderMagic === 0x20b ? 112 : 96);
  const securityDirectoryOffset = dataDirectoryOffset + (4 * 8);
  const certificateOffset = executable.readUInt32LE(securityDirectoryOffset);
  const certificateSize = executable.readUInt32LE(securityDirectoryOffset + 4);
  if (!certificateOffset || !certificateSize) return;

  executable.writeUInt32LE(0, securityDirectoryOffset);
  executable.writeUInt32LE(0, securityDirectoryOffset + 4);
  const certificateEnd = certificateOffset + certificateSize;
  const unsignedExecutable = certificateEnd <= executable.length
    && certificateEnd >= executable.length - 8
    ? executable.subarray(0, certificateOffset)
    : executable;
  await writeFile(filePath, unsignedExecutable);
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
await removeAuthenticodeSignature(exePath);

await rcedit(exePath, {
  icon: iconPath,
  'file-version': '0.1.0',
  'product-version': '0.1.0',
  'version-string': {
    CompanyName: '木辛说',
    FileDescription: '木辛说视频下载器',
    ProductName: '木辛说视频下载器',
    OriginalFilename: '木辛说视频下载器.exe',
  },
});

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
