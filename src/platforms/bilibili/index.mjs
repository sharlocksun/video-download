import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { resolveBaseDir } from '../../core/filename.mjs';
import { makeTempDir } from '../../core/temp-dir.mjs';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const API_HEADERS = {
  'User-Agent': USER_AGENT,
  Referer: 'https://www.bilibili.com/',
};

const QUALITY_TO_QN = {
  best: 120,
  '4k': 120,
  '2160': 120,
  '2160p': 120,
  '2k': 112,
  '1440': 112,
  '1440p': 112,
  '1080p60': 116,
  '1080p60+': 116,
  '1080p60fps': 116,
  '1080+': 112,
  '1080p+': 112,
  '1080': 80,
  '1080p': 80,
  '720': 64,
  '720p': 64,
  '540': 32,
  '540p': 32,
  '480': 32,
  '480p': 32,
  lowest: 16,
  '360': 16,
  '360p': 16,
};

const QN_LABELS = new Map([
  [120, '4K'],
  [116, '1080P60'],
  [112, '1080P+'],
  [80, '1080P'],
  [64, '720P'],
  [32, '480P'],
  [16, '360P'],
]);

function supportsBilibiliUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'b23.tv'
      || parsed.hostname === 'bilibili.com'
      || parsed.hostname.endsWith('.bilibili.com');
  } catch {
    return false;
  }
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function reportLog(options, message) {
  options?.onLog?.(message);
  console.log(message);
}

function reportProgress(options, payload) {
  options?.onProgress?.(payload);
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

function buildOutputPath(outDir, template, info, overwrite) {
  const date = new Date().toISOString().slice(0, 10);
  const title = sanitizeFilePart(info.title, 'bilibili', 80);
  const id = sanitizeFilePart(info.id, 'video');
  const fileName = template
    .replaceAll('%id%', id)
    .replaceAll('%title%', title)
    .replaceAll('%date%', date);

  const safeFileName = sanitizeFilePart(fileName, `bilibili_${id}.mp4`);
  const withExt = path.extname(safeFileName) ? safeFileName : `${safeFileName}.mp4`;
  return getUniquePath(path.resolve(outDir, withExt), overwrite);
}

async function resolveFinalUrl(inputUrl) {
  const response = await fetch(inputUrl, {
    method: 'GET',
    redirect: 'follow',
    headers: API_HEADERS,
  });
  return response.url || inputUrl;
}

function extractBvid(url) {
  const matched = String(url || '').match(/BV[a-zA-Z0-9]+/);
  return matched ? matched[0] : null;
}

function getPageNumber(url) {
  try {
    const parsed = new URL(url);
    const page = Number(parsed.searchParams.get('p') || 1);
    return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  } catch {
    return 1;
  }
}

function requestHeaders(referer, cookieHeader = '') {
  return {
    ...API_HEADERS,
    Referer: referer || API_HEADERS.Referer,
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  };
}

async function fetchJson(url, referer, cookieHeader = '') {
  const response = await fetch(url, { headers: requestHeaders(referer, cookieHeader) });
  if (!response.ok) {
    throw new Error(`Bilibili 接口返回 HTTP ${response.status}`);
  }
  const json = await response.json();
  if (json.code !== 0) {
    throw new Error(`Bilibili 接口错误：${json.message || json.code}`);
  }
  return json.data;
}

async function getViewInfo(bvid, cookieHeader = '') {
  const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
  return fetchJson(url, `https://www.bilibili.com/video/${bvid}/`, cookieHeader);
}

function pickPage(view, pageNumber) {
  const pages = Array.isArray(view.pages) ? view.pages : [];
  if (!pages.length) {
    throw new Error('Bilibili 视频没有可下载分 P 信息');
  }
  return pages[Math.min(pageNumber, pages.length) - 1] || pages[0];
}

function qualityToQn(quality, acceptQuality = []) {
  const wanted = QUALITY_TO_QN[String(quality || 'best').toLowerCase()] || 120;
  if (String(quality || 'best').toLowerCase() === 'best' && acceptQuality.length) {
    return Math.max(...acceptQuality);
  }
  return wanted;
}

async function getPlayInfo(bvid, cid, qn, fnval, cookieHeader = '') {
  const params = new URLSearchParams({
    bvid,
    cid: String(cid),
    qn: String(qn),
    fnval: String(fnval),
    fourk: '1',
  });
  const referer = `https://www.bilibili.com/video/${bvid}/`;
  return fetchJson(`https://api.bilibili.com/x/player/playurl?${params}`, referer, cookieHeader);
}

function describeAvailable(playInfo) {
  const qualities = Array.isArray(playInfo.accept_quality) ? playInfo.accept_quality : [];
  const descriptions = Array.isArray(playInfo.accept_description) ? playInfo.accept_description : [];
  return qualities.map((qn, index) => descriptions[index] || QN_LABELS.get(qn) || `${qn}`).join(', ');
}

function pickDurl(playInfo) {
  const parts = Array.isArray(playInfo.durl) ? playInfo.durl : [];
  return parts.find((part) => /^https?:\/\//.test(part.url || '')) || null;
}

function trackQn(track) {
  return Number(track.id) || 0;
}

function trackPixels(track) {
  return (Number(track.width) || 0) * (Number(track.height) || 0);
}

function pickDashVideo(playInfo, requestedQn) {
  const videos = Array.isArray(playInfo.dash?.video) ? playInfo.dash.video : [];
  const usable = videos.filter((item) => /^https?:\/\//.test(item.baseUrl || item.base_url || ''));
  if (!usable.length) return null;

  const target = requestedQn || Math.max(...usable.map(trackQn));
  const byPreference = (item) => {
    const codec = String(item.codecs || '');
    if (codec.startsWith('avc1')) return 0;
    if (codec.startsWith('hev1') || codec.startsWith('hvc1')) return 1;
    return 2;
  };

  return [...usable].sort((a, b) => {
    if (requestedQn) {
      const aDistance = Math.abs(trackQn(a) - target);
      const bDistance = Math.abs(trackQn(b) - target);
      if (aDistance !== bDistance) return aDistance - bDistance;
      const aBelow = trackQn(a) < target ? 1 : 0;
      const bBelow = trackQn(b) < target ? 1 : 0;
      if (aBelow !== bBelow) return aBelow - bBelow;
    } else if (trackQn(a) !== trackQn(b)) {
      return trackQn(b) - trackQn(a);
    }
    return trackPixels(b) - trackPixels(a)
      || byPreference(a) - byPreference(b)
      || (Number(b.bandwidth) || 0) - (Number(a.bandwidth) || 0);
  })[0];
}

function pickDashAudio(playInfo) {
  const audios = Array.isArray(playInfo.dash?.audio) ? playInfo.dash.audio : [];
  return audios
    .filter((item) => /^https?:\/\//.test(item.baseUrl || item.base_url || ''))
    .sort((a, b) => (Number(b.bandwidth) || 0) - (Number(a.bandwidth) || 0))[0] || null;
}

function cleanPathInput(value) {
  return String(value || '').trim().replace(/^["']|["']$/g, '');
}

async function addFfmpegCandidatesFromInput(candidates, input) {
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
    path.join(value, 'ffmpeg.exe'),
    path.join(value, 'bin', 'ffmpeg.exe'),
  );

  try {
    const entries = await readdir(value, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        candidates.push(path.join(value, entry.name, 'bin', 'ffmpeg.exe'));
      }
    }
  } catch {}
}

async function findFfmpeg(explicitPath = '') {
  const candidates = [];
  await addFfmpegCandidatesFromInput(candidates, explicitPath);
  await addFfmpegCandidatesFromInput(candidates, process.env.FFMPEG_PATH);
  const baseDir = resolveBaseDir();
  await addFfmpegCandidatesFromInput(candidates, path.join(baseDir, 'downloads', 'ffmpeg', 'ffmpeg-release-essentials'));
  await addFfmpegCandidatesFromInput(candidates, path.join(baseDir, 'downloads', 'ffmpeg'));
  candidates.push('ffmpeg.exe', 'ffmpeg');
  const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
  for (const candidate of uniqueCandidates) {
    try {
      await new Promise((resolve, reject) => {
        const proc = spawn(candidate, ['-version'], { stdio: 'ignore', windowsHide: true });
        proc.on('error', reject);
        proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
      });
      return candidate;
    } catch {}
  }
  return null;
}

async function downloadToFile(src, outputPath, info, options = {}) {
  if (options.signal?.aborted) {
    throw new Error('任务已终止');
  }
  const response = await fetch(src, {
    headers: {
      'User-Agent': USER_AGENT,
      Referer: info.referer,
      Range: 'bytes=0-',
      ...(info.cookieHeader ? { Cookie: info.cookieHeader } : {}),
    },
    signal: options.signal,
  });
  if (!response.ok && response.status !== 206) {
    throw new Error(`媒体请求返回 HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Error('该清晰度暂时不可直接下载。请改选 720P 或更低画质；如果仍失败，可能是视频本身受限。');
  }
  if (!response.body) {
    throw new Error('媒体响应没有可读取内容');
  }

  const total = Number(response.headers.get('content-length')) || null;
  const reader = response.body.getReader();
  const file = createWriteStream(outputPath);
  let downloaded = 0;
  let lastPrint = 0;

  try {
    for (;;) {
      if (options.signal?.aborted) {
        await reader.cancel().catch(() => {});
        throw new Error('任务已终止');
      }
      const { done, value } = await reader.read();
      if (done) break;
      downloaded += value.byteLength;
      if (!file.write(Buffer.from(value))) {
        await once(file, 'drain');
      }
      const now = Date.now();
      if (total && now - lastPrint > 1000) {
        lastPrint = now;
        const percent = Number(((downloaded / total) * 100).toFixed(1));
        reportProgress(options, { downloaded, total, percent, outputPath });
        process.stdout.write(`  ${percent}% (${downloaded}/${total} bytes)\r`);
      }
    }
  } finally {
    file.end();
    await once(file, 'finish');
  }

  if (total) {
    reportProgress(options, { downloaded, total, percent: 100, outputPath });
    process.stdout.write(' '.repeat(60) + '\r');
  }
  return stat(outputPath);
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

async function mergeWithFfmpeg(ffmpegPath, videoPath, audioPath, outputPath, options = {}) {
  await new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error('任务已终止'));
      return;
    }
    const proc = spawn(ffmpegPath, [
      '-y',
      '-i', videoPath,
      '-i', audioPath,
      '-c', 'copy',
      '-movflags', '+faststart',
      outputPath,
    ], { stdio: 'ignore', windowsHide: true });
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      killProcessTree(proc);
      reject(new Error('任务已终止'));
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
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
      code === 0 ? resolve() : reject(new Error(`ffmpeg 合并失败，退出码 ${code}`));
    });
  });
  return stat(outputPath);
}

async function getVideoInfo(url, options = {}) {
  const finalUrl = url.includes('b23.tv') ? await resolveFinalUrl(url) : url;
  const bvid = extractBvid(finalUrl);
  if (!bvid) {
    throw new Error('无法从链接中识别 Bilibili BV 号');
  }

  const cookieHeader = options.bilibiliCookieHeader || '';
  const pageNumber = getPageNumber(finalUrl);
  const view = await getViewInfo(bvid, cookieHeader);
  const page = pickPage(view, pageNumber);
  const probe = await getPlayInfo(bvid, page.cid, 120, 4048, cookieHeader);
  const requestedQn = qualityToQn(options.quality, probe.accept_quality);
  const durlPlayInfo = await getPlayInfo(bvid, page.cid, requestedQn, 0, cookieHeader);
  const dashPlayInfo = await getPlayInfo(bvid, page.cid, requestedQn, 4048, cookieHeader);
  const durl = pickDurl(durlPlayInfo);
  const dashVideo = pickDashVideo(dashPlayInfo, requestedQn);
  const dashAudio = pickDashAudio(dashPlayInfo);
  const durlQn = Number(durlPlayInfo.quality) || 0;
  const dashQn = trackQn(dashVideo);
  const preferDash = dashVideo && dashAudio && dashQn > durlQn;
  const selectedQn = preferDash ? dashQn : durlQn || dashQn || requestedQn;
  const selectedLabel = QN_LABELS.get(selectedQn) || `${selectedQn}`;
  const availableQualities = describeAvailable(dashPlayInfo) || describeAvailable(durlPlayInfo);
  const base = {
    id: page.page && view.pages?.length > 1 ? `${bvid}_p${page.page}` : bvid,
    bvid,
    cid: page.cid,
    title: view.pages?.length > 1 ? `${view.title}_P${page.page}_${page.part}` : view.title,
    duration: page.duration || view.duration || null,
    referer: `https://www.bilibili.com/video/${bvid}/`,
    cookieHeader,
    requestedQn,
    selectedQn,
    selectedQuality: selectedLabel,
    availableQualities,
    loggedIn: Boolean(cookieHeader),
  };

  if (preferDash) {
    return {
      ...base,
      mode: 'dash',
      videoSrc: dashVideo.baseUrl || dashVideo.base_url,
      audioSrc: dashAudio.baseUrl || dashAudio.base_url,
      videoCodec: dashVideo.codecs || '',
      audioCodec: dashAudio.codecs || '',
      width: dashVideo.width || null,
      height: dashVideo.height || null,
    };
  }

  if (durl) {
    return {
      ...base,
      mode: 'durl',
      src: durl.url,
      size: durl.size || null,
      format: durlPlayInfo.format || 'mp4',
    };
  }

  if (dashVideo && dashAudio) {
    return {
      ...base,
      mode: 'dash',
      videoSrc: dashVideo.baseUrl || dashVideo.base_url,
      audioSrc: dashAudio.baseUrl || dashAudio.base_url,
      videoCodec: dashVideo.codecs || '',
      audioCodec: dashAudio.codecs || '',
      width: dashVideo.width || null,
      height: dashVideo.height || null,
    };
  }

  throw new Error('当前视频没有返回可保存的媒体地址');
}

async function downloadDash(info, outputPath, options = {}) {
  const ffmpegPath = await findFfmpeg(options.ffmpegPath);
  if (!ffmpegPath) {
    throw new Error('当前清晰度需要合并 DASH 音视频，但没有找到 ffmpeg。请安装 ffmpeg，或先选择 720P/更低画质。');
  }

  const tempDir = await makeTempDir('muxin-bilibili');
  const videoPath = path.join(tempDir, 'video.m4s');
  const audioPath = path.join(tempDir, 'audio.m4s');
  try {
    reportLog(options, '  Downloading DASH video track...');
    await downloadToFile(info.videoSrc, videoPath, info, options);
    reportLog(options, '  Downloading DASH audio track...');
    await downloadToFile(info.audioSrc, audioPath, info, options);
    reportLog(options, '  Merging with ffmpeg...');
    return await mergeWithFfmpeg(ffmpegPath, videoPath, audioPath, outputPath, options);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function downloadOne(url, options = {}) {
  reportLog(options, `Opening: ${url}`);
  const info = await getVideoInfo(url, options);

  reportLog(options, `  Title: ${info.title || '(no title)'}`);
  reportLog(options, `  ID: ${info.id}`);
  if (info.duration) {
    reportLog(options, `  Duration: ${Math.round(info.duration)}s`);
  }
  if (info.availableQualities) {
    reportLog(options, `  Available qualities: ${info.availableQualities}`);
  }
  if (info.requestedQn !== info.selectedQn) {
    const requested = QN_LABELS.get(info.requestedQn) || `${info.requestedQn}`;
    reportLog(options, `  Requested quality: ${requested}`);
    reportLog(options, `  Selected quality: ${info.selectedQuality}（所选清晰度暂不可用，已自动使用可下载版本）`);
  } else {
    reportLog(options, `  Selected quality: ${info.selectedQuality}`);
  }
  reportLog(options, `  Source type: bilibili ${info.mode === 'dash' ? 'dash video+audio' : 'durl mp4'}`);
  if (info.mode === 'dash' && (info.width || info.height)) {
    reportLog(options, `  DASH video: ${info.width || '?'}x${info.height || '?'} ${info.videoCodec || ''}`.trim());
  }

  if (options.infoOnly) {
    if (info.mode === 'dash') {
      reportLog(options, `  Video source: ${info.videoSrc}`);
      reportLog(options, `  Audio source: ${info.audioSrc}`);
    } else {
      reportLog(options, `  Source: ${info.src}`);
    }
    return null;
  }

  await mkdir(path.resolve(options.outDir), { recursive: true });
  const outputPath = await buildOutputPath(options.outDir, options.nameTemplate, info, options.overwrite);
  reportLog(options, `  Saving: ${outputPath}`);
  const saved = info.mode === 'dash'
    ? await downloadDash(info, outputPath, options)
    : await downloadToFile(info.src, outputPath, info, options);
  reportLog(options, `  Done: ${saved.size} bytes`);
  return outputPath;
}

const platform = {
  id: 'bilibili',
  name: 'Bilibili',
  supports: supportsBilibiliUrl,
  downloadOne,
};

export { findFfmpeg, getVideoInfo, platform, downloadOne };
