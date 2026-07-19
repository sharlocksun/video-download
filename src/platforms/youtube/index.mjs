import { spawn } from 'node:child_process';
import { access, mkdir, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findJavaScriptRuntime } from '../../core/runtime-tools.mjs';
import { makeTempDir } from '../../core/temp-dir.mjs';
import { fileURLToPath } from 'node:url';
import { findFfmpeg } from '../bilibili/index.mjs';

const QUALITY_TO_HEIGHT = {
  best: null,
  '4k': 2160,
  '2160': 2160,
  '2160p': 2160,
  '2k': 1440,
  '1440': 1440,
  '1440p': 1440,
  '1080+': 1080,
  '1080p+': 1080,
  '1080': 1080,
  '1080p': 1080,
  '720': 720,
  '720p': 720,
  '540': 540,
  '540p': 540,
  '480': 480,
  '480p': 480,
  lowest: 360,
  '360': 360,
  '360p': 360,
  '240': 240,
  '240p': 240,
  '144': 144,
  '144p': 144,
};

function supportsYoutubeUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    return host === 'youtube.com'
      || host === 'youtu.be'
      || host === 'm.youtube.com'
      || host === 'music.youtube.com';
  } catch {
    return false;
  }
}

function reportLog(options, message) {
  options?.onLog?.(message);
  console.log(message);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function cleanPathInput(value) {
  return String(value || '').trim().replace(/^["']|["']$/g, '');
}

async function addExecutableCandidates(candidates, input, exeName) {
  const value = cleanPathInput(input);
  if (!value) return;
  candidates.push(value);

  try {
    const info = await stat(value);
    if (!info.isDirectory()) return;
  } catch {
    return;
  }

  candidates.push(
    path.join(value, exeName),
    path.join(value, 'bin', exeName),
  );

  try {
    const entries = await readdir(value, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        candidates.push(path.join(value, entry.name, exeName));
        candidates.push(path.join(value, entry.name, 'bin', exeName));
      }
    }
  } catch {}
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
  candidates.push(
    process.env.NODE_PATH,
    'node.exe',
    'node',
  );

  if (process.platform === 'win32') {
    candidates.push(
      'C:/Program Files/nodejs/node.exe',
      'C:/Program Files (x86)/nodejs/node.exe',
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/opt/homebrew/bin/node',
      '/usr/local/bin/node',
      '/usr/bin/node',
    );
  } else {
    candidates.push(
      '/usr/local/bin/node',
      '/usr/bin/node',
      '/bin/node',
    );
  }

  for (const candidate of [...new Set(candidates.filter(Boolean).map(cleanPathInput))]) {
    if (await canRun(candidate, ['--version'])) {
      cachedNodeRuntime = candidate;
      return cachedNodeRuntime;
    }
  }
  cachedNodeRuntime = '';
  return cachedNodeRuntime;
}

async function buildYtDlpCommonArgs() {
  const args = ['--ignore-config'];
  const runtime = await findJavaScriptRuntime();
  if (runtime) args.push('--js-runtimes', `${runtime.name}:${runtime.path}`);
  return args;
}

function addDefaultYtDlpCandidates(candidates) {
  const roots = [];
  roots.push(process.cwd());

  if (process.argv[1]) {
    roots.push(path.dirname(path.resolve(process.argv[1])));
  }

  if (process.execPath) {
    const exeDir = path.dirname(process.execPath);
    roots.push(exeDir, path.dirname(exeDir));
  }

  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    roots.push(moduleDir, path.resolve(moduleDir, '..', '..', '..'));
  } catch {}

  for (const root of [...new Set(roots.filter(Boolean))]) {
    candidates.push(
      path.join(root, 'yt-dlp.exe'),
      path.join(root, 'downloads', 'yt-dlp.exe'),
      path.join(root, 'downloads', 'yt-dlp', 'yt-dlp.exe'),
      path.join(root, 'downloads', 'yt-dlp', 'bin', 'yt-dlp.exe'),
      path.join(root, 'bin', 'yt-dlp.exe'),
      path.join(root, 'tools', 'yt-dlp.exe'),
      path.join(root, 'tools', 'yt-dlp', 'yt-dlp.exe'),
      path.join(root, 'tools', 'yt-dlp', 'bin', 'yt-dlp.exe'),
      path.join(root, 'yt-dlp'),
      path.join(root, 'runtime', 'yt-dlp'),
      path.join(root, 'downloads', 'yt-dlp', 'yt-dlp'),
      path.join(root, 'bin', 'yt-dlp'),
      path.join(root, 'tools', 'yt-dlp'),
    );
  }
}

async function findYtDlp(explicitPath = '') {
  const candidates = [];
  await addExecutableCandidates(candidates, explicitPath, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  await addExecutableCandidates(candidates, process.env.YT_DLP_PATH, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  addDefaultYtDlpCandidates(candidates);
  candidates.push('yt-dlp.exe', 'yt-dlp');

  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    if (await canRun(candidate, ['--version'])) {
      return candidate;
    }
  }
  return null;
}

function sanitizeFilePart(value, fallback = 'untitled', maxLength = 120) {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+$/, '');

  return (cleaned || fallback).slice(0, maxLength);
}

async function getUniquePath(filePath, overwrite) {
  if (overwrite || !(await exists(filePath))) {
    return filePath;
  }

  const parsed = path.parse(filePath);
  for (let i = 1; i < 1000; i += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}_${i}${parsed.ext}`);
    if (!(await exists(candidate))) {
      return candidate;
    }
  }

  throw new Error(`无法找到可用文件名：${filePath}`);
}

function buildOutputPath(outDir, template, info, overwrite, platformSlug = 'youtube') {
  const date = new Date().toISOString().slice(0, 10);
  const title = sanitizeFilePart(info.title, platformSlug, 80);
  const id = sanitizeFilePart(info.id, 'video');
  const fileName = template
    .replaceAll('%id%', id)
    .replaceAll('%title%', title)
    .replaceAll('%date%', date);

  const safeFileName = sanitizeFilePart(fileName, `${platformSlug}_${id}.mp4`);
  const withExt = path.extname(safeFileName) ? safeFileName : `${safeFileName}.mp4`;
  return getUniquePath(path.resolve(outDir, withExt), overwrite);
}

function abortError() {
  const error = new Error('任务已终止');
  error.name = 'AbortError';
  return error;
}

function killProcessTree(proc) {
  if (!proc || proc.killed || proc.exitCode !== null) return;
  if (process.platform === 'win32' && proc.pid) {
    spawn('taskkill.exe', ['/pid', String(proc.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    }).on('error', () => {
      proc.kill();
    });
    return;
  }
  proc.kill('SIGKILL');
}

function runCollect(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }
    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let settled = false;
    let aborted = false;
    let stdout = '';
    let stderr = '';
    const onAbort = () => {
      if (settled) return;
      aborted = true;
      settled = true;
      killProcessTree(proc);
      reject(abortError());
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => { if (!aborted) stdout += chunk; });
    proc.stderr.on('data', (chunk) => { if (!aborted) stderr += chunk; });
    proc.on('error', (error) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    proc.on('exit', (code) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || stdout || `yt-dlp exited with code ${code}`).trim()));
    });
  });
}

function runStreaming(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }
    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let settled = false;
    let aborted = false;
    let output = '';
    const onAbort = () => {
      if (settled) return;
      aborted = true;
      settled = true;
      killProcessTree(proc);
      reject(abortError());
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const handleLine = (line) => {
      if (aborted || options.signal?.aborted) return;
      const text = String(line || '').trim();
      if (!text) return;
      output += `${text}\n`;
      if (/\[download\]\s+\d/.test(text)) {
        const matched = text.match(/(\d+(?:\.\d+)?)%/);
        if (matched) {
          options.onProgress?.({ percent: Number(matched[1]) });
        }
        return;
      }
      reportLog(options, `  ${text}`);
    };
    for (const stream of [proc.stdout, proc.stderr]) {
      stream.setEncoding('utf8');
      let buffer = '';
      stream.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) handleLine(line);
      });
      stream.on('end', () => {
        if (buffer) handleLine(buffer);
      });
    }
    proc.on('error', (error) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    proc.on('exit', (code) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      if (code === 0) resolve();
      else reject(new Error(output.trim() || `yt-dlp 下载失败，退出码 ${code}`));
    });
  });
}

async function findFfprobe(ffmpegPath = '') {
  const candidates = [];
  const ffmpeg = cleanPathInput(ffmpegPath);
  if (ffmpeg) {
    const lower = path.basename(ffmpeg).toLowerCase();
    if (lower === 'ffmpeg.exe' || lower === 'ffmpeg') {
      candidates.push(path.join(path.dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'));
    } else {
      candidates.push(
        path.join(ffmpeg, 'ffprobe.exe'),
        path.join(ffmpeg, 'ffprobe'),
        path.join(ffmpeg, 'bin', 'ffprobe.exe'),
        path.join(ffmpeg, 'bin', 'ffprobe'),
      );
    }
  }
  candidates.push('ffprobe.exe', 'ffprobe');
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    if (await canRun(candidate, ['-version'])) return candidate;
  }
  return '';
}

async function hasAudioStream(filePath, ffmpegPath = '') {
  const ffprobe = await findFfprobe(ffmpegPath);
  if (!ffprobe) return null;
  try {
    const { stdout } = await runCollect(ffprobe, [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=codec_type',
      '-of', 'csv=p=0',
      filePath,
    ]);
    return String(stdout || '').split(/\r?\n/).some((line) => line.trim() === 'audio');
  } catch {
    return null;
  }
}

async function runYtDlpDownload(ytDlpPath, commonArgs, format, outputPath, url, ffmpegPath, options = {}, rawInfo = null) {
  const args = [
    ...commonArgs,
    '--no-playlist',
    '--newline',
    '-f', format,
    '--merge-output-format', 'mp4',
    '-o', outputPath,
    ...buildYtDlpAuthArgs(options),
  ];
  if (ffmpegPath) {
    args.push('--ffmpeg-location', ffmpegPath);
  }
  let tempDir = '';
  try {
    if (rawInfo) {
      tempDir = await makeTempDir('yt-dlp-resolved-info');
      const infoPath = path.join(tempDir, 'info.json');
      await writeFile(infoPath, JSON.stringify(rawInfo), 'utf8');
      args.push('--load-info-json', infoPath);
    } else {
      args.push(url);
    }
    await runStreaming(ytDlpPath, args, options);
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function videoQualitySide(format) {
  const width = Number(format?.width) || 0;
  const height = Number(format?.height) || 0;
  if (width && height) return Math.min(width, height);
  return height || width || 0;
}

function combinedFormatSelector(quality, hasFfmpeg, info = null) {
  const key = String(quality || 'best').toLowerCase();
  if (key === 'lowest') {
    return hasFfmpeg ? 'worst[acodec!=none][vcodec!=none]/worstvideo*+worstaudio/worst' : 'worst[acodec!=none][vcodec!=none]/worst';
  }

  const height = Object.hasOwn(QUALITY_TO_HEIGHT, key)
    ? QUALITY_TO_HEIGHT[key]
    : (/^\d{3,4}p?$/.test(key) ? Number(key.replace(/p$/, '')) : null);
  if (!height) {
    return hasFfmpeg ? 'best[acodec!=none][vcodec!=none]/bestvideo*+bestaudio/best' : 'best[acodec!=none][vcodec!=none]/best';
  }

  const videoFormats = (info?.formats || []).filter((item) => item.vcodec && item.vcodec !== 'none' && videoQualitySide(item));
  const vertical = videoFormats.some((item) => Number(item.height) > Number(item.width));
  const dimension = vertical ? 'width' : 'height';
  return hasFfmpeg
    ? `best[${dimension}<=${height}][acodec!=none][vcodec!=none]/bestvideo*[${dimension}<=${height}]+bestaudio/best[${dimension}<=${height}]/best`
    : `best[${dimension}<=${height}][acodec!=none][vcodec!=none]/best[${dimension}<=${height}]/best`;
}

function formatSelector(quality, hasFfmpeg, info = null, platformSlug = 'youtube') {
  if (platformSlug === 'tiktok' || platformSlug === 'instagram') {
    return combinedFormatSelector(quality, hasFfmpeg, info);
  }
  const key = String(quality || 'best').toLowerCase();
  if (key === 'lowest') {
    return hasFfmpeg ? 'worstvideo[ext=mp4]+worstaudio[ext=m4a]/worst[ext=mp4][acodec!=none][vcodec!=none]/worst[acodec!=none][vcodec!=none]/worst' : 'worst[ext=mp4][acodec!=none][vcodec!=none]/worst[acodec!=none][vcodec!=none]/worst';
  }

  const height = Object.hasOwn(QUALITY_TO_HEIGHT, key)
    ? QUALITY_TO_HEIGHT[key]
    : (/^\d{3,4}p?$/.test(key) ? Number(key.replace(/p$/, '')) : null);
  if (!height) {
    return hasFfmpeg ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4][acodec!=none][vcodec!=none]/best[acodec!=none][vcodec!=none]/best' : 'best[ext=mp4][acodec!=none][vcodec!=none]/best[acodec!=none][vcodec!=none]/best';
  }

  const videoFormats = (info?.formats || []).filter((item) => item.vcodec && item.vcodec !== 'none' && videoQualitySide(item));
  const vertical = videoFormats.some((item) => Number(item.height) > Number(item.width));
  const dimension = vertical ? 'width' : 'height';
  return hasFfmpeg
    ? `bestvideo[ext=mp4][${dimension}<=${height}]+bestaudio[ext=m4a]/best[ext=mp4][${dimension}<=${height}][acodec!=none][vcodec!=none]/best[${dimension}<=${height}][acodec!=none][vcodec!=none]/best`
    : `best[${dimension}<=${height}][ext=mp4][acodec!=none][vcodec!=none]/best[${dimension}<=${height}][acodec!=none][vcodec!=none]/best`;
}

function describeFormats(info) {
  const heights = new Set();
  for (const item of info.formats || []) {
    const side = videoQualitySide(item);
    if (side && item.vcodec && item.vcodec !== 'none') heights.add(side);
  }
  return [...heights]
    .sort((a, b) => b - a)
    .slice(0, 8)
    .map((height) => `${height}P`)
    .join(', ');
}

function buildYtDlpAuthArgs(options = {}) {
  const cookiesPath = cleanPathInput(options.ytDlpCookiesPath);
  if (cookiesPath) {
    return ['--cookies', cookiesPath];
  }

  const cookiesFromBrowser = normalizeBrowserAuthValue(options.ytDlpCookiesFromBrowser);
  if (cookiesFromBrowser && cookiesFromBrowser !== 'none') {
    return ['--cookies-from-browser', cookiesFromBrowser];
  }

  return [];
}

function describeYtDlpAuth(options = {}) {
  if (cleanPathInput(options.ytDlpCookiesPath)) return 'cookies.txt';
  const cookiesFromBrowser = normalizeBrowserAuthValue(options.ytDlpCookiesFromBrowser);
  if (cookiesFromBrowser && cookiesFromBrowser !== 'none') return `${browserLabel(cookiesFromBrowser)} 登录状态`;
  return '';
}

function normalizeBrowserAuthValue(value) {
  const raw = cleanPathInput(value);
  if (!raw) return '';
  if (raw.toLowerCase() === 'none') return 'none';
  const match = raw.match(/^(chrome|edge|firefox|brave)(?::(.+))?$/i);
  if (!match) return raw;
  return `${match[1].toLowerCase()}${match[2] ? `:${match[2]}` : ''}`;
}

function browserLabel(browser) {
  const raw = String(browser || '').trim();
  const [browserName, ...profileParts] = raw.split(':');
  const profile = profileParts.join(':').trim();
  const labels = {
    chrome: 'Chrome',
    edge: 'Edge',
    firefox: 'Firefox',
    brave: 'Brave',
  };
  const label = labels[String(browserName || '').toLowerCase()] || browserName || raw;
  return profile ? `${label} ${profile}` : label;
}

function explainYtDlpError(error, platformName, options = {}) {
  const message = String(error?.message || error || '');
  const selectedBrowser = normalizeBrowserAuthValue(options.ytDlpCookiesFromBrowser);
  const selectedBrowserName = browserLabel(selectedBrowser);
  const lowerPlatform = String(platformName || '').toLowerCase();
  const isYoutube = lowerPlatform.includes('youtube');
  const isInstagram = lowerPlatform.includes('instagram');
  if (/Failed to decrypt with DPAPI/i.test(message)) {
    const browserText = selectedBrowser ? selectedBrowserName : '当前浏览器';
    return new Error(`${browserText} 的 ${platformName} Cookie 被 Windows/浏览器加密保护，yt-dlp 无法解密。请使用本程序登录窗口，或改为不使用登录状态。原始错误：${message}`);
  }
  if (/Could not copy .*cookie database/i.test(message)) {
    const browserText = selectedBrowser ? selectedBrowserName : '对应浏览器';
    return new Error(`${browserText} 的 ${platformName} 登录状态读取失败。请使用本程序登录窗口，或改为不使用登录状态。原始错误：${message}`);
  }
  if (/n challenge solving failed|Only images are available|Requested format is not available/i.test(message)) {
    if (isYoutube) {
      return new Error(`${platformName} 没有拿到可下载的视频流。通常是 yt-dlp 没有可用的 JavaScript 运行时，无法解析 YouTube 的播放挑战。请在“环境与组件”中修复 Deno 运行时后重试。原始错误：${message}`);
    }
    return new Error(`${platformName} 没有拿到可下载的视频流。请先确认链接在浏览器里可访问；如果需要登录，请在当前平台的登录来源里选择本程序登录窗口并登录。原始错误：${message}`);
  }
  if (/Sign in to confirm|not a bot|cookies-from-browser|cookies|empty media response|accessible in your browser/i.test(message)) {
    const authLabel = isInstagram ? 'Instagram 登录来源' : isYoutube ? 'YouTube 登录来源' : `${platformName} 登录来源`;
    return new Error(`${platformName} 触发了平台登录/机器人验证。请在 ${authLabel} 里选择本程序登录窗口并登录，或改为不使用登录状态。原始错误：${message}`);
  }
  return error;
}

async function getYtDlpRawInfo(url, options = {}, platformName = 'YouTube', settings = {}) {
  const ytDlpPath = await findYtDlp(options.ytDlpPath);
  if (!ytDlpPath) {
    throw new Error(`没有找到 yt-dlp。请把 yt-dlp.exe 放到程序目录或 downloads 文件夹，也可以在 ${platformName} 设置里手动填写路径。`);
  }

  let stdout;
  try {
    const commonArgs = await buildYtDlpCommonArgs();
    ({ stdout } = await runCollect(ytDlpPath, [
      ...commonArgs,
      '--dump-single-json',
      ...(settings.allowPlaylist ? [] : ['--no-playlist']),
      ...(settings.ignoreNoFormats ? ['--ignore-no-formats-error'] : []),
      '--no-warnings',
      '--skip-download',
      ...buildYtDlpAuthArgs(options),
      url,
    ], options));
  } catch (error) {
    throw explainYtDlpError(error, platformName, options);
  }
  return { ytDlpPath, info: JSON.parse(stdout) };
}

async function getYtDlpVideoInfo(url, options = {}, platformName = 'YouTube') {
  const { ytDlpPath, info } = await getYtDlpRawInfo(url, options, platformName);
  return {
    ytDlpPath,
    id: info.id || 'youtube',
    title: info.title || 'YouTube video',
    duration: info.duration || null,
    uploader: info.uploader || info.channel || '',
    webpageUrl: info.webpage_url || url,
    formats: info.formats || [],
    availableQualities: describeFormats(info),
    rawInfo: info,
  };
}

async function downloadWithYtDlp(url, options = {}, platformName = 'YouTube', platformSlug = 'youtube') {
  reportLog(options, `Opening: ${url}`);
  const cachedInfo = options.ytDlpResolvedInfo?.info?.rawInfo
    ? options.ytDlpResolvedInfo.info
    : null;
  let info = cachedInfo || await getYtDlpVideoInfo(url, options, platformName);
  const ffmpegPath = await findFfmpeg(options.ffmpegPath);
  const hasFfmpeg = Boolean(ffmpegPath);
  const outputPath = await buildOutputPath(options.outDir, options.nameTemplate, info, options.overwrite, platformSlug);
  let format = formatSelector(options.quality, hasFfmpeg, info, platformSlug);

  if (cachedInfo) {
    reportLog(options, `  使用识别画质时锁定的 ${platformName} 媒体信息，不再重新解析网页。`);
  }

  reportLog(options, `  Title: ${info.title || '(no title)'}`);
  reportLog(options, `  ID: ${info.id}`);
  if (info.uploader) reportLog(options, `  Uploader: ${info.uploader}`);
  if (info.duration) reportLog(options, `  Duration: ${Math.round(info.duration)}s`);
  if (info.availableQualities) reportLog(options, `  Available qualities: ${info.availableQualities}`);
  reportLog(options, `  Selected format: ${format}`);
  if (!hasFfmpeg) {
    reportLog(options, '  ffmpeg 未找到：将优先下载单文件视频流，高画质合并可能不可用。');
  }
  const authSource = describeYtDlpAuth(options);
  if (authSource) {
    reportLog(options, `  Cookie: 使用 ${authSource}`);
  }

  if (options.infoOnly) {
    reportLog(options, `  Source: ${info.webpageUrl}`);
    return {
      platform: platformSlug,
      info,
      pageUrl: url,
      capturedAt: Date.now(),
    };
  }

  await mkdir(path.resolve(options.outDir), { recursive: true });
  reportLog(options, `  Saving: ${outputPath}`);
  const commonArgs = await buildYtDlpCommonArgs();
  try {
    try {
      await runYtDlpDownload(info.ytDlpPath, commonArgs, format, outputPath, url, ffmpegPath, options, info.rawInfo || null);
    } catch (error) {
      if (!cachedInfo || options.signal?.aborted) throw error;
      reportLog(options, `  识别阶段锁定的 ${platformName} 媒体地址已失效，正在重新解析后继续下载。`);
      await unlink(outputPath).catch(() => {});
      info = await getYtDlpVideoInfo(url, options, platformName);
      format = formatSelector(options.quality, hasFfmpeg, info, platformSlug);
      reportLog(options, `  Refreshed format: ${format}`);
      await runYtDlpDownload(info.ytDlpPath, commonArgs, format, outputPath, url, ffmpegPath, options);
    }
    if (platformSlug === 'tiktok' || platformSlug === 'instagram') {
      const audio = await hasAudioStream(outputPath, ffmpegPath);
      const platformLabel = platformSlug === 'instagram' ? 'Instagram' : 'TikTok';
      if (audio === false) {
        const retryFormat = hasFfmpeg
          ? 'bestvideo*+bestaudio/best[acodec!=none][vcodec!=none]/best'
          : 'best[acodec!=none][vcodec!=none]/best';
        reportLog(options, `  ${platformLabel} 音轨检测：当前文件没有音频，正在换用备用格式重新下载...`);
        await unlink(outputPath).catch(() => {});
        reportLog(options, `  Retry format: ${retryFormat}`);
        await runYtDlpDownload(info.ytDlpPath, commonArgs, retryFormat, outputPath, url, ffmpegPath, options, info.rawInfo || null);
        const retryAudio = await hasAudioStream(outputPath, ffmpegPath);
        if (retryAudio === false) {
          throw new Error(`${platformLabel} 下载完成但文件仍然没有音轨。可能该链接的可用格式本身不含音频，或平台返回了异常视频流。`);
        }
      } else if (audio === true) {
        reportLog(options, `  ${platformLabel} 音轨检测：已包含音频。`);
      } else {
        reportLog(options, `  ${platformLabel} 音轨检测：未找到 ffprobe，无法自动校验音轨。`);
      }
    }
  } catch (error) {
    throw explainYtDlpError(error, platformName, options);
  }
  const saved = await stat(outputPath).catch(() => null);
  if (saved) {
    reportLog(options, `  Done: ${saved.size} bytes`);
  } else {
    reportLog(options, '  Done');
  }
  return outputPath;
}

async function getVideoInfo(url, options = {}) {
  return getYtDlpVideoInfo(url, options, 'YouTube');
}

async function downloadOne(url, options = {}) {
  return downloadWithYtDlp(url, options, 'YouTube', 'youtube');
}

const platform = {
  id: 'youtube',
  name: 'YouTube',
  supports: supportsYoutubeUrl,
  downloadOne,
};

export { downloadOne, downloadWithYtDlp, findYtDlp, getVideoInfo, getYtDlpRawInfo, getYtDlpVideoInfo, platform };
