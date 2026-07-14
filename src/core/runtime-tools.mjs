import { spawn } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveComponentsDir, resolveInstallDir } from './app-paths.mjs';

async function canRun(command, args = ['--version']) {
  return new Promise((resolve) => {
    if (!command) return resolve(false);
    const proc = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    proc.on('error', () => resolve(false));
    proc.on('exit', (code) => resolve(code === 0));
  });
}

async function firstRunnable(candidates, args = ['--version']) {
  for (const item of [...new Set(candidates.filter(Boolean))]) {
    if (await canRun(item, args)) return item;
  }
  return '';
}

function executableName(name) {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

async function findJavaScriptRuntime() {
  const install = resolveInstallDir();
  const components = resolveComponentsDir();
  const denoName = executableName('deno');
  const deno = await firstRunnable([
    path.join(install, 'runtime', denoName),
    path.join(install, denoName),
    path.join(components, 'deno', denoName),
    process.env.DENO_PATH,
    denoName,
    'deno',
  ]);
  if (deno) return { name: 'deno', path: deno };
  const currentNode = /^node(?:\.exe)?$/i.test(path.basename(process.execPath)) ? process.execPath : '';
  const node = await firstRunnable([currentNode, process.env.NODE_PATH, executableName('node'), 'node']);
  return node ? { name: 'node', path: node } : null;
}

async function findBundledTool(name) {
  const install = resolveInstallDir();
  const executable = executableName(name);
  const candidates = name === 'yt-dlp'
    ? [path.join(install, 'runtime', executable), path.join(install, 'downloads', 'yt-dlp', executable)]
    : [path.join(install, 'runtime', executable), path.join(install, 'downloads', 'ffmpeg', 'ffmpeg-release-essentials')];
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) {
        await access(candidate);
        return candidate;
      }
    } catch {}
  }
  return '';
}

export { canRun, executableName, findBundledTool, findJavaScriptRuntime };
