import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, removeTempDir } from '../core/temp-dir.mjs';

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

async function runYtDlpForSubtitles(ytDlpPath, videoUrl, tempDir) {
  return new Promise((resolve) => {
    const proc = spawn(ytDlpPath, [
      '--ignore-config',
      '--no-playlist',
      '--skip-download',
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs',
      'zh-Hans,zh-CN,zh,en,en.*',
      '--sub-format',
      'vtt/srt/ass/best',
      '-o',
      '%(id)s.%(ext)s',
      videoUrl,
    ], {
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

async function extractSubtitlesFromUrl(videoUrl, ytDlpPath) {
  if (!videoUrl) throw new Error('请先填写参考视频链接。');
  if (!ytDlpPath) throw new Error('没有找到 yt-dlp，无法提取平台字幕。');
  const tempDir = await makeTempDir('muxin-subtitles');
  try {
    const result = await runYtDlpForSubtitles(ytDlpPath, videoUrl, tempDir);
    if (!result.ok) {
      throw new Error(result.error || 'yt-dlp 提取字幕失败。');
    }
    const files = await readdir(tempDir);
    const subtitleFiles = files
      .filter((file) => /\.(vtt|srt|ass)$/i.test(file))
      .sort((a, b) => {
        const score = (name) => (/zh|cn|hans/i.test(name) ? 0 : /en/i.test(name) ? 1 : 2);
        return score(a) - score(b) || a.localeCompare(b);
      });
    if (!subtitleFiles.length) {
      throw new Error('没有找到可用字幕。这个平台或视频可能没有公开字幕/自动字幕。');
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
