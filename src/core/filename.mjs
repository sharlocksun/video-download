import path from 'node:path';
import { resolveDefaultVideoDir, resolveInstallDir } from './app-paths.mjs';

function normalizeNameTemplateForBatch(template, count) {
  const value = String(template || '').trim() || '%title%_%id%.mp4';
  if (count <= 1 || /%(id|title|date)%/.test(value)) {
    return value;
  }

  const parsed = path.parse(value);
  if (parsed.ext) {
    return `${parsed.name}_%id%${parsed.ext}`;
  }
  return `${value}_%id%.mp4`;
}

function resolveBaseDir() {
  return resolveInstallDir();
}

function resolveOutDir(input) {
  const value = String(input || '').trim();
  if (!value || value === 'videos') return resolveDefaultVideoDir();
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(resolveBaseDir(), value);
}

export { normalizeNameTemplateForBatch, resolveBaseDir, resolveOutDir };
