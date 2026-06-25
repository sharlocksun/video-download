import path from 'node:path';

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
  const exeName = path.basename(process.execPath).toLowerCase();
  if (exeName === 'muxin-video-downloader.exe') {
    const exeDir = path.dirname(process.execPath);
    return path.basename(exeDir).toLowerCase() === 'dist' ? path.dirname(exeDir) : exeDir;
  }
  return process.cwd();
}

function resolveOutDir(input) {
  const value = String(input || '').trim() || 'videos';
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(resolveBaseDir(), value);
}

export { normalizeNameTemplateForBatch, resolveBaseDir, resolveOutDir };
