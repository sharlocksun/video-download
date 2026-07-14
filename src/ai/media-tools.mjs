import { spawn } from 'node:child_process';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveDefaultVideoDir } from '../core/app-paths.mjs';
import { cleanTranscript, extractTimestampLines } from './local-analysis.mjs';
import { stripSubtitleMarkup } from './subtitles.mjs';

async function assertReadableFile(filePath) {
  const resolved = path.resolve(String(filePath || '').trim());
  if (!resolved) throw new Error('请先填写本地视频/音频文件路径。');
  await access(resolved);
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error('填写的路径不是文件。');
  return resolved;
}

function assetDirForMedia(inputPath) {
  const parsed = path.parse(inputPath);
  return path.join(parsed.dir, `${parsed.name}_assets`);
}

function sanitizeFilePart(value = '', fallback = 'video') {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

function sourceKeyFromUrl(sourceUrl = '') {
  try {
    const parsed = new URL(sourceUrl);
    const host = parsed.hostname.toLowerCase();
    const platform = host.includes('youtube') || host === 'youtu.be' ? 'youtube'
      : host.includes('bilibili') || host === 'b23.tv' ? 'bilibili'
        : host.includes('douyin') ? 'douyin'
          : host.includes('kuaishou') || host.includes('gifshow') ? 'kuaishou'
            : host.includes('xiaohongshu') || host.includes('xhs') ? 'xiaohongshu'
              : host.includes('tiktok') ? 'tiktok'
                : host.includes('instagram') || host.includes('instagr.am') ? 'instagram'
                  : sanitizeFilePart(host.replace(/^www\./, ''), 'platform');
    const id = parsed.searchParams.get('v')
      || parsed.pathname.match(/BV[0-9A-Za-z]+/)?.[0]
      || parsed.pathname.split('/').filter(Boolean).pop()
      || 'link';
    return `${platform}_${sanitizeFilePart(id, 'link')}`;
  } catch {
    return 'unknown_link';
  }
}

function analysisDirForSource(sourceUrl = '', title = '') {
  const base = path.join(resolveDefaultVideoDir(), '_analysis');
  const key = sourceKeyFromUrl(sourceUrl);
  const titlePart = sanitizeFilePart(title, '');
  return path.join(base, titlePart ? `${titlePart}_${key}` : key);
}

async function fileExists(filePath = '') {
  try {
    const resolved = path.resolve(String(filePath || '').trim());
    const info = await stat(resolved);
    return info.isFile() ? resolved : '';
  } catch {
    return '';
  }
}

async function resolveAssetRoot(inputFile = '', options = {}) {
  const inputPath = await fileExists(inputFile);
  const mediaExts = new Set(['.mp4', '.m4v', '.mov', '.mkv', '.webm', '.flv', '.avi', '.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg']);
  if (inputPath && (!options.sourceUrl || mediaExts.has(path.extname(inputPath).toLowerCase()))) {
    return { inputPath, assetDir: assetDirForMedia(inputPath), sourceKind: 'file' };
  }
  if (options.outDir) return { inputPath: '', assetDir: path.resolve(String(options.outDir)), sourceKind: 'directory' };
  if (options.sourceUrl) return {
    inputPath: '',
    assetDir: analysisDirForSource(String(options.sourceUrl), String(options.title || '')),
    sourceKind: 'url',
  };
  throw new Error('请先填写已下载视频/音频路径，或提供原视频链接用于创建分析资料夹。');
}

function subDir(assetDir, kind) {
  if (kind === 'audio') return path.join(assetDir, 'audio');
  if (kind === 'ai') return path.join(assetDir, 'ai');
  if (kind === 'video') return path.join(assetDir, 'video');
  return path.join(assetDir, 'subtitles');
}

function artifactGroupDir(assetDir, kind, group = '') {
  const root = subDir(assetDir, kind);
  const cleanGroup = sanitizeFilePart(group, '');
  return cleanGroup ? path.join(root, cleanGroup) : root;
}

async function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { timeoutMs = 180_000, ...spawnOptions } = options;
    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      ...spawnOptions,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`${path.basename(command)} 执行超时。`));
    }, timeoutMs);
    proc.stdout?.setEncoding('utf8');
    proc.stderr?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk) => { stdout += chunk; });
    proc.stderr?.on('data', (chunk) => { stderr += chunk; });
    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error((stderr || stdout || `${path.basename(command)} exited with code ${code}`).trim()));
    });
  });
}

async function extractEmbeddedSubtitle(inputFile, ffmpegPath, format = 'srt') {
  const inputPath = await assertReadableFile(inputFile);
  if (!ffmpegPath) throw new Error('没有找到 ffmpeg，无法提取内嵌字幕。');
  const targetFormat = format === 'vtt' ? 'vtt' : 'srt';
  const assetDir = assetDirForMedia(inputPath);
  const dir = subDir(assetDir, 'subtitles');
  await mkdir(dir, { recursive: true });
  const outputPath = path.join(dir, `embedded_subtitles.${targetFormat}`);
  const codec = targetFormat === 'vtt' ? 'webvtt' : 'srt';
  await runProcess(ffmpegPath, [
    '-y',
    '-i',
    inputPath,
    '-map',
    '0:s:0',
    '-c:s',
    codec,
    outputPath,
  ]);
  const raw = await readFile(outputPath, 'utf8');
  const text = stripSubtitleMarkup(raw);
  if (!text) throw new Error('已提取内嵌字幕文件，但内容为空或无法解析。');
  return {
    inputPath,
    assetDir,
    outputPath,
    text,
  };
}

async function extractAudioFile(inputFile, ffmpegPath) {
  const inputPath = await assertReadableFile(inputFile);
  if (!ffmpegPath) throw new Error('没有找到 ffmpeg，无法提取音频。');
  const assetDir = assetDirForMedia(inputPath);
  const dir = subDir(assetDir, 'audio');
  await mkdir(dir, { recursive: true });
  const outputPath = path.join(dir, 'audio.mp3');
  await runProcess(ffmpegPath, [
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-b:a',
    '128k',
    outputPath,
  ]);
  return {
    inputPath,
    assetDir,
    outputPath,
  };
}

function escapeVttText(text) {
  return String(text || '').replaceAll('-->', '->').trim();
}

function secondsToSrtTime(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},000`;
}

function secondsToVttTime(totalSeconds) {
  return secondsToSrtTime(totalSeconds).replace(',', '.');
}

function chunkTextForSubtitle(text) {
  const cleaned = cleanTranscript(text).replace(/\n+/g, '\n');
  const lines = cleaned.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  return cleaned
    .split(/(?<=[。！？!?；;])\s*/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function resolvedSubtitleChunks(text, providedChunks = []) {
  if (Array.isArray(providedChunks) && providedChunks.length) {
    return providedChunks
      .map((chunk) => String(chunk || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join('\n'))
      .filter(Boolean);
  }
  return chunkTextForSubtitle(text);
}

function textToSrt(text, providedChunks = []) {
  const chunks = resolvedSubtitleChunks(text, providedChunks);
  return `${chunks.map((chunk, index) => {
    const start = index * 4;
    const end = start + 4;
    return [
      String(index + 1),
      `${secondsToSrtTime(start)} --> ${secondsToSrtTime(end)}`,
      escapeVttText(chunk),
    ].join('\n');
  }).join('\n\n')}\n`;
}

function textToVtt(text, providedChunks = []) {
  const chunks = resolvedSubtitleChunks(text, providedChunks);
  return `WEBVTT\n\n${chunks.map((chunk, index) => {
    const start = index * 4;
    const end = start + 4;
    return [
      `${secondsToVttTime(start)} --> ${secondsToVttTime(end)}`,
      escapeVttText(chunk),
    ].join('\n');
  }).join('\n\n')}\n`;
}

function timelineText(text, providedChunks = []) {
  if (!providedChunks.length) {
    const timestampLines = extractTimestampLines(text);
    if (timestampLines.length) {
      return timestampLines.map((item, index) => `${index + 1}. ${item.time} ${item.text}`).join('\n');
    }
  }
  const chunks = resolvedSubtitleChunks(text, providedChunks);
  return chunks.map((chunk, index) => `${index + 1}. ${secondsToVttTime(index * 4)} ${chunk}`).join('\n');
}

async function saveTranscriptArtifacts(inputFile, transcript, options = {}) {
  const target = await resolveAssetRoot(inputFile, options);
  const cleaned = cleanTranscript(transcript);
  if (!cleaned) throw new Error('没有可保存的字幕/转写文本。');
  const subtitleChunks = Array.isArray(options.subtitleChunks) ? options.subtitleChunks : [];
  const dir = artifactGroupDir(target.assetDir, 'subtitles', options.group || options.category || '');
  await mkdir(dir, { recursive: true });
  const files = [];
  const formats = new Set(Array.isArray(options.formats) && options.formats.length ? options.formats : ['txt']);
  const baseName = sanitizeFilePart(options.baseName || 'transcript', 'transcript');
  if (formats.has('txt')) {
    const filePath = path.join(dir, `${baseName}.txt`);
    await writeFile(filePath, `${cleaned}\n`, 'utf8');
    files.push(filePath);
  }
  if (formats.has('srt')) {
    const filePath = path.join(dir, `${baseName}.srt`);
    await writeFile(filePath, textToSrt(cleaned, subtitleChunks), 'utf8');
    files.push(filePath);
  }
  if (formats.has('vtt')) {
    const filePath = path.join(dir, `${baseName}.vtt`);
    await writeFile(filePath, textToVtt(cleaned, subtitleChunks), 'utf8');
    files.push(filePath);
  }
  if (options.timeline) {
    const filePath = path.join(dir, `${baseName}_timeline.txt`);
    await writeFile(filePath, `${timelineText(cleaned, subtitleChunks)}\n`, 'utf8');
    files.push(filePath);
  }
  const metadataPath = path.join(target.assetDir, 'metadata.json');
  await writeFile(metadataPath, `${JSON.stringify({
    inputPath: target.inputPath,
    sourceUrl: options.sourceUrl || '',
    sourceKind: target.sourceKind,
    kind: 'transcript',
    baseName,
    generatedAt: new Date().toISOString(),
    files,
  }, null, 2)}\n`, 'utf8');
  files.push(metadataPath);
  return {
    inputPath: target.inputPath,
    assetDir: target.assetDir,
    outputDir: dir,
    cleaned,
    timeline: timelineText(cleaned, subtitleChunks),
    files,
  };
}

function formatAiChatMarkdown(payload = {}) {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const lines = [
    `# AI 创作记录`,
    '',
    `- 平台：${payload.platform || 'general'}`,
    payload.sourceUrl ? `- 参考链接：${payload.sourceUrl}` : '',
    payload.filePath ? `- 本地文件：${payload.filePath}` : '',
    `- 导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    '---',
    '',
  ].filter(Boolean);
  for (const item of messages) {
    const role = item.role === 'assistant' ? 'AI' : item.role === 'system' ? '系统' : '用户';
    lines.push(`## ${role}`, '', String(item.content || '').trim(), '');
  }
  return `${lines.join('\n').trim()}\n`;
}

function formatAiChatText(payload = {}) {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const lines = [
    'AI 创作记录',
    `平台：${payload.platform || 'general'}`,
    payload.sourceUrl ? `参考链接：${payload.sourceUrl}` : '',
    payload.filePath ? `本地文件：${payload.filePath}` : '',
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
  ].filter(Boolean);
  for (const item of messages) {
    const role = item.role === 'assistant' ? 'AI' : item.role === 'system' ? '系统' : '用户';
    lines.push(`[${role}]`, String(item.content || '').trim(), '');
  }
  return `${lines.join('\n').trim()}\n`;
}

async function saveAiArtifacts(options = {}) {
  const target = await resolveAssetRoot(options.filePath || '', {
    sourceUrl: options.sourceUrl || '',
    title: options.title || '',
    outDir: options.outDir || '',
  });
  const dir = subDir(target.assetDir, 'ai');
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_');
  const name = sanitizeFilePart(options.baseName || `ai_${options.platform || 'general'}_${stamp}`, 'ai_export');
  const files = [];
  if ((options.formats || ['md', 'txt']).includes('md')) {
    const filePath = path.join(dir, `${name}.md`);
    await writeFile(filePath, formatAiChatMarkdown(options), 'utf8');
    files.push(filePath);
  }
  if ((options.formats || ['md', 'txt']).includes('txt')) {
    const filePath = path.join(dir, `${name}.txt`);
    await writeFile(filePath, formatAiChatText(options), 'utf8');
    files.push(filePath);
  }
  return { assetDir: target.assetDir, outputDir: dir, files };
}

export {
  assetDirForMedia,
  analysisDirForSource,
  extractAudioFile,
  extractEmbeddedSubtitle,
  saveTranscriptArtifacts,
  saveAiArtifacts,
  sanitizeFilePart,
  textToSrt,
  textToVtt,
  timelineText,
};
