import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, removeTempDir } from '../core/temp-dir.mjs';
import { subtitleLanguageArgs } from './transcript-normalize.mjs';
import { findJavaScriptRuntime } from '../core/runtime-tools.mjs';

function stripSubtitleMarkup(text = '') {
  const seen = new Set();
  const lines = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^WEBVTT|^NOTE|^STYLE|^Kind:|^Language:/i.test(line))
    .filter((line) => !/^\d+$/.test(line))
    .filter((line) => !/^\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s+-->/i.test(line))
    .map((line) => line
      .replace(/\{\\[^}]+}/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean)
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return lines.join('\n');
}

async function canRun(command, args) {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    proc.on('error', () => resolve(false));
    proc.on('exit', (code) => resolve(code === 0));
  });
}

let cachedNodeRuntime;

async function findNodeRuntime() {
  if (cachedNodeRuntime !== undefined) return cachedNodeRuntime;
  const candidates = [];
  if (path.basename(process.execPath || '').toLowerCase() === 'node.exe') {
    candidates.push(process.execPath);
  }
  candidates.push(process.env.NODE_PATH, 'node.exe', 'node');
  if (process.platform === 'win32') {
    candidates.push(
      'C:/Program Files/nodejs/node.exe',
      'C:/Program Files (x86)/nodejs/node.exe',
    );
  } else if (process.platform === 'darwin') {
    candidates.push('/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node');
  } else {
    candidates.push('/usr/local/bin/node', '/usr/bin/node', '/bin/node');
  }
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    if (await canRun(candidate, ['--version'])) {
      cachedNodeRuntime = candidate;
      return cachedNodeRuntime;
    }
  }
  cachedNodeRuntime = '';
  return cachedNodeRuntime;
}

function cleanPathInput(value = '') {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function ytDlpAuthArgs(options = {}) {
  const cookiesPath = cleanPathInput(options.ytDlpCookiesPath);
  if (cookiesPath) return ['--cookies', cookiesPath];
  const cookiesFromBrowser = cleanPathInput(options.ytDlpCookiesFromBrowser);
  if (cookiesFromBrowser && cookiesFromBrowser.toLowerCase() !== 'none') {
    return ['--cookies-from-browser', cookiesFromBrowser];
  }
  return [];
}

async function runYtDlpForSubtitles(ytDlpPath, videoUrl, tempDir, options = {}) {
  const runtime = await findJavaScriptRuntime();
  const args = ['--ignore-config'];
  if (runtime) args.push('--js-runtimes', `:`);
  args.push(
    '--no-playlist',
    '--skip-download',
    '--write-subs',
    '--write-auto-subs',
    '--sub-langs',
    subtitleLanguageArgs(options.transcriptLanguage),
    '--sub-format',
    'vtt/srt/ass/best',
    '-o',
    '%(id)s.%(ext)s',
    ...ytDlpAuthArgs(options),
    videoUrl,
  );
  return new Promise((resolve) => {
    const proc = spawn(ytDlpPath, args, {
      cwd: tempDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill();
    }, 120_000);
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message, stdout, stderr });
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        error: code === 0 ? '' : (stderr || stdout || `yt-dlp exited with code ${code}`).trim(),
        stdout,
        stderr,
      });
    });
  });
}

function platformHint(videoUrl = '') {
  try {
    const parsed = new URL(videoUrl);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('youtube') || host === 'youtu.be') return 'YouTube';
    if (host.includes('bilibili') || host === 'b23.tv') return 'Bilibili';
    if (host.includes('douyin')) return '抖音';
    if (host.includes('kuaishou') || host.includes('gifshow')) return '快手';
    if (host.includes('xiaohongshu') || host.includes('xhs')) return '小红书';
    if (host.includes('tiktok')) return 'TikTok';
    if (host.includes('instagram') || host.includes('instagr.am')) return 'Instagram';
  } catch {
    // Keep the generic hint when the URL is not parseable.
  }
  return '当前平台';
}

async function extractSubtitlesFromUrl(videoUrl, ytDlpPath, options = {}) {
  if (!videoUrl) throw new Error('请先填写参考视频链接。');
  if (!ytDlpPath) throw new Error('没有找到 yt-dlp，无法提取平台字幕。');
  const tempDir = await makeTempDir('muxin-subtitles');
  try {
    const result = await runYtDlpForSubtitles(ytDlpPath, videoUrl, tempDir, options);
    const files = await readdir(tempDir);
    const subtitleFiles = files
      .filter((file) => /\.(vtt|srt|ass)$/i.test(file))
      .sort((a, b) => {
        const preferEnglish = String(options.transcriptLanguage || '').startsWith('en');
        const score = (name) => {
          const isZh = /zh|cn|hans|hant/i.test(name);
          const isEn = /en/i.test(name);
          if (preferEnglish) return isEn ? 0 : isZh ? 1 : 2;
          return isZh ? 0 : isEn ? 1 : 2;
        };
        return score(a) - score(b) || a.localeCompare(b);
      });
    if (!result.ok && !subtitleFiles.length) {
      throw new Error(result.error || 'yt-dlp 提取字幕失败。');
    }
    if (!subtitleFiles.length) {
      throw new Error(`${platformHint(videoUrl)}没有返回可下载的平台字幕。这很常见，请先下载视频，再用本地 Whisper 从声音转文字。`);
    }
    const selected = subtitleFiles[0];
    const raw = await readFile(path.join(tempDir, selected), 'utf8');
    const text = stripSubtitleMarkup(raw);
    if (!text) throw new Error('字幕文件为空或无法解析。');
    return {
      file: selected,
      text,
      available: subtitleFiles,
    };
  } finally {
    await removeTempDir(tempDir);
  }
}

export {
  extractSubtitlesFromUrl,
  stripSubtitleMarkup,
};
