import os from 'node:os';
import { access, mkdir } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

const APP_DIR_NAME = 'MuxinVideoDownloader';
const VIDEO_DIR_NAME = '木辛说视频下载器';

function isPackagedExecutable() {
  if (process.env.MUXIN_PACKAGED === '1') return true;
  const name = path.basename(process.execPath).toLowerCase().replace(/\.exe$/i, '');
  return name === 'muxin-video-downloader' || name === '木辛说视频下载器';
}

function resolveInstallDir() {
  if (!isPackagedExecutable()) return process.cwd();
  const exeDir = path.dirname(process.execPath);
  if (process.platform === 'darwin' && path.basename(exeDir) === 'MacOS') {
    return path.resolve(exeDir, '..', 'Resources');
  }
  return path.basename(exeDir).toLowerCase() === 'dist' ? path.dirname(exeDir) : exeDir;
}

function resolveDataDir() {
  if (process.env.MUXIN_DATA_DIR) return path.resolve(process.env.MUXIN_DATA_DIR);
  if (!isPackagedExecutable() && !process.env.MUXIN_PORTABLE) return path.join(process.cwd(), 'user-data');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', APP_DIR_NAME);
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, APP_DIR_NAME);
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), APP_DIR_NAME);
}

function resolveComponentsDir() {
  const preferred = path.join(resolveDataDir(), 'components');
  if (process.platform !== 'win32' || /^[\x00-\x7F]+$/.test(preferred)) return preferred;
  const publicDir = process.env.PUBLIC || path.join(path.parse(os.homedir()).root, 'Users', 'Public');
  return path.join(publicDir, 'Documents', APP_DIR_NAME, 'components');
}

function resolveUserVideoDir() {
  const mediaRoot = process.platform === 'darwin' ? 'Movies' : 'Videos';
  return path.join(os.homedir(), mediaRoot, VIDEO_DIR_NAME);
}

function resolveDefaultVideoDir() {
  if (process.env.MUXIN_VIDEO_DIR) return path.resolve(process.env.MUXIN_VIDEO_DIR);
  if (!isPackagedExecutable() && !process.env.MUXIN_CUSTOMER_LAYOUT) return path.join(process.cwd(), 'videos');
  if (process.platform === 'darwin') return resolveUserVideoDir();
  return path.join(resolveInstallDir(), 'videos');
}

async function ensureDefaultVideoDir() {
  const preferred = resolveDefaultVideoDir();
  try {
    await mkdir(preferred, { recursive: true });
    await access(preferred, fsConstants.W_OK);
    process.env.MUXIN_VIDEO_DIR = preferred;
    return preferred;
  } catch {
    const fallback = resolveUserVideoDir();
    await mkdir(fallback, { recursive: true });
    process.env.MUXIN_VIDEO_DIR = fallback;
    return fallback;
  }
}

function resolveLegacyToolDir(...parts) {
  return path.join(resolveInstallDir(), 'downloads', ...parts);
}

export {
  APP_DIR_NAME,
  VIDEO_DIR_NAME,
  ensureDefaultVideoDir,
  isPackagedExecutable,
  resolveComponentsDir,
  resolveDataDir,
  resolveDefaultVideoDir,
  resolveInstallDir,
  resolveLegacyToolDir,
  resolveUserVideoDir,
};
