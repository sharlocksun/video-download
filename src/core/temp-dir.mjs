import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveBaseDir } from './filename.mjs';

function tempRootCandidates() {
  const explicit = String(process.env.MUXIN_TEMP_DIR || '').trim();
  return [
    explicit,
    path.join(resolveBaseDir(), 'tmp'),
    os.tmpdir(),
  ].filter(Boolean);
}

async function makeTempDir(prefix) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let lastError = null;

  for (const root of tempRootCandidates()) {
    const dir = path.join(root, `${prefix}-${suffix}`);
    try {
      await mkdir(dir, { recursive: true });
      return dir;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Could not create temporary directory');
}

async function removeTempDir(dir) {
  if (!dir) return;
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

export { makeTempDir, removeTempDir };
