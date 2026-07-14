import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolveComponentsDir, resolveInstallDir } from './app-paths.mjs';

const WHISPER_EXECUTABLE = process.platform === 'win32' ? 'Release/whisper-cli.exe' : 'whisper-cli';
const COMPONENT_MANIFEST = {
  whisperCpu: { id: 'whisperCpu', version: '1.9.1', kind: 'zip', url: process.platform === 'win32' ? 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-Win32.zip' : '', installDir: 'whisper/engine-cpu', executable: WHISPER_EXECUTABLE },
  whisperVulkan: { id: 'whisperVulkan', version: '1.9.1-muxin1', kind: 'zip', url: process.platform === 'win32' ? 'https://github.com/sharlocksun/video-download/releases/download/components-v1/whisper-vulkan-win-x64.zip' : '', installDir: 'whisper/engine-vulkan', executable: process.platform === 'win32' ? 'Release/whisper-cli.exe' : 'whisper-cli', optional: true, available: false },
  whisperSmall: { id: 'whisperSmall', version: '2025-06', kind: 'file', url: 'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small.bin', urls: ['https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small.bin', 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin'], installDir: 'whisper/models', fileName: 'ggml-small.bin', sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b', size: 487601967 },
  whisperMedium: { id: 'whisperMedium', version: '2025-06', kind: 'file', url: 'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin', urls: ['https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin', 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin'], installDir: 'whisper/models', fileName: 'ggml-medium.bin', sha256: '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208', size: 1533763059 },
  whisperLargeV3: { id: 'whisperLargeV3', version: '2025-06', kind: 'file', url: 'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin', urls: ['https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin', 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin'], installDir: 'whisper/models', fileName: 'ggml-large-v3.bin', sha256: '64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2', size: 3095033483 },
};
function componentRoot(item) { return path.join(resolveComponentsDir(), item.installDir); }
function componentTarget(item) { return path.join(componentRoot(item), item.fileName || item.executable || ''); }
async function exists(filePath) { try { await access(filePath); return true; } catch { return false; } }
async function sha256File(filePath) { const hash = createHash('sha256'); await pipeline(createReadStream(filePath), hash); return hash.digest('hex'); }
async function expandZip(zipPath, destination) {
  await mkdir(destination, { recursive: true });
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'powershell.exe' : 'ditto';
    const args = process.platform === 'win32'
      ? ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zipPath.replaceAll("'", "''")}' -DestinationPath '${destination.replaceAll("'", "''")}' -Force`]
      : ['-x', '-k', zipPath, destination];
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('error', reject);
    proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr || `${command} exited with ${code}`)));
  });
}
async function downloadWithCurl(url, outputPath, options = {}) {
  const partial = `${outputPath}.part`;
  await mkdir(path.dirname(partial), { recursive: true });
  const run = async (resume = true) => new Promise((resolve, reject) => {
    const args = ['--location', '--fail', '--retry', '3', '--retry-all-errors', '--connect-timeout', '20'];
    if (resume) args.push('--continue-at', '-');
    args.push('--output', partial, url);
    const proc = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    let lastPercent = -1;
    const timer = setInterval(async () => {
      const received = (await stat(partial).catch(() => ({ size: 0 }))).size;
      const total = Number(options.expectedSize || 0);
      const percent = total ? Math.min(99, Math.round(received / total * 100)) : 0;
      if (percent !== lastPercent) {
        lastPercent = percent;
        options.onProgress?.({ received, total, percent });
      }
    }, 500);
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('error', (error) => { clearInterval(timer); reject(error); });
    proc.on('exit', (code) => {
      clearInterval(timer);
      if (code === 0) resolve();
      else reject(new Error((stderr || `curl exited with code ${code}`).trim()));
    });
  });
  try {
    await run(true);
  } catch (error) {
    const partialSize = (await stat(partial).catch(() => ({ size: 0 }))).size;
    if (!partialSize) throw error;
    await rm(partial, { force: true });
    await run(false);
  }
  const received = (await stat(partial)).size;
  options.onProgress?.({ received, total: Number(options.expectedSize || received), percent: 100 });
  await rm(outputPath, { force: true });
  await rename(partial, outputPath);
  return outputPath;
}

async function downloadFile(url, outputPath, options = {}) {
  if (process.platform === 'win32') {
    try { return await downloadWithCurl(url, outputPath, options); }
    catch (curlError) { options.onFallback?.(curlError); }
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  const partial = `${outputPath}.part`;
  let offset = 0;
  try { offset = (await stat(partial)).size; } catch {}
  const headers = offset ? { Range: `bytes=${offset}-` } : {};
  const response = await fetch(url, { headers, redirect: 'follow' });
  if (!response.ok && response.status !== 206) throw new Error(`组件下载失败：HTTP ${response.status}`);
  if (offset && response.status === 200) { await rm(partial, { force: true }); offset = 0; }
  const total = Number(options.expectedSize || response.headers.get('content-length') || 0) + (options.expectedSize ? 0 : offset);
  const stream = createWriteStream(partial, { flags: offset ? 'a' : 'w' });
  let received = offset;
  let lastPercent = -1;
  const reader = response.body.getReader();
  const monitored = new Readable({ async read() { try { const { done, value } = await reader.read(); if (done) return this.push(null); received += value.length; const percent = total ? Math.round(received / total * 100) : 0; if (percent !== lastPercent) { lastPercent = percent; options.onProgress?.({ received, total, percent }); } this.push(Buffer.from(value)); } catch (error) { this.destroy(error); } } });
  await pipeline(monitored, stream);
  await rm(outputPath, { force: true });
  await rename(partial, outputPath);
  return outputPath;
}

async function ensureBundledWhisperCpu() {
  const item = COMPONENT_MANIFEST.whisperCpu;
  const target = componentTarget(item);
  if (await exists(target)) return true;
  const bundled = path.join(resolveInstallDir(), 'runtime', 'whisper', 'engine-cpu');
  if (!(await exists(path.join(bundled, WHISPER_EXECUTABLE)))) return false;
  await mkdir(path.dirname(componentRoot(item)), { recursive: true });
  await cp(bundled, componentRoot(item), { recursive: true, force: true });
  return exists(target);
}
async function componentStatus(id) { const item = COMPONENT_MANIFEST[id]; if (!item) throw new Error(`未知组件：${id}`); const target = componentTarget(item); const installed = await exists(target); let valid = installed; if (installed && item.sha256) valid = (await sha256File(target)) === item.sha256; return { ...item, target, installed, valid }; }
async function installComponent(id, options = {}) { const item = COMPONENT_MANIFEST[id]; if (!item) throw new Error(`未知组件：${id}`); if (id === 'whisperCpu' && process.platform === 'darwin') { await rm(componentRoot(item), { recursive: true, force: true }); if (!await ensureBundledWhisperCpu()) throw new Error('macOS Whisper 引擎缺失，请重新安装应用程序。'); return componentStatus(id); } if (item.available === false) throw new Error('GPU 加速组件尚未发布，请暂时使用内置 CPU 引擎。'); const root = componentRoot(item); await mkdir(root, { recursive: true }); const cacheDir = path.join(resolveComponentsDir(), '.downloads'); const archive = path.join(cacheDir, `${id}-${item.version}.${item.kind === 'zip' ? 'zip' : 'bin'}`); const sources = Array.isArray(item.urls) && item.urls.length ? item.urls : [item.url];
  const sourceErrors = [];
  let downloaded = false;
  for (const sourceUrl of sources) {
    try {
      await downloadFile(sourceUrl, archive, { ...options, expectedSize: item.size || 0 });
      downloaded = true;
      break;
    } catch (error) {
      sourceErrors.push(`${new URL(sourceUrl).hostname}：${error.message}`);
    }
  }
  if (!downloaded) throw new Error(`所有下载源均失败。\n${sourceErrors.join('\n')}`); if (item.sha256 && await sha256File(archive) !== item.sha256) { await rm(archive, { force: true }); throw new Error('组件校验失败，已删除损坏文件。'); } if (item.kind === 'zip') { await rm(root, { recursive: true, force: true }); await expandZip(archive, root); } else { await rm(componentTarget(item), { force: true }); await rename(archive, componentTarget(item)); } const status = await componentStatus(id); if (!status.installed || !status.valid) throw new Error('组件安装后校验失败。'); await writeFile(path.join(root, '.component.json'), JSON.stringify({ id, version: item.version, installedAt: new Date().toISOString() }, null, 2), 'utf8'); return status; }
async function removeComponent(id) { const item = COMPONENT_MANIFEST[id]; if (!item) throw new Error(`未知组件：${id}`); await rm(componentRoot(item), { recursive: true, force: true }); }
async function listComponentStatus() { await ensureBundledWhisperCpu(); const result = {}; for (const id of Object.keys(COMPONENT_MANIFEST)) result[id] = await componentStatus(id); return result; }
export { COMPONENT_MANIFEST, componentStatus, ensureBundledWhisperCpu, installComponent, listComponentStatus, removeComponent };
