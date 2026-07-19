import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  rm,
  stat,
} from 'node:fs/promises';
import {
  createConnection,
  createServer,
} from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { createInterface } from 'node:readline/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { makeTempDir } from '../../core/temp-dir.mjs';
import { findFfmpeg } from '../bilibili/index.mjs';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const DEFAULT_TIMEOUT_MS = 180_000;
let interactiveMode = false;
const DOUYIN_MEDIA_PROBE_SCRIPT = `
(() => {
  for (const key of ['MediaSource', 'ManagedMediaSource']) {
    try {
      Object.defineProperty(window, key, {
        configurable: true,
        value: undefined,
      });
    } catch {}
  }
})();
`;

function printHelp() {
  console.log(`
Douyin Downloader

Usage:
  douyin-downloader.exe <douyin-url> [more-urls...] [options]
  node douyin-downloader.mjs <douyin-url> [more-urls...] [options]

Options:
  -o, --out <dir>          Output directory. Default: current directory
  -n, --name <template>    File name template. Default: %title%_%id%.mp4
                           Available tokens: %id%, %title%, %date%
  --browser <path>         Chrome or Edge executable path
  --show-browser           Open a visible browser window
  --keep-profile           Keep the temporary browser profile for debugging
  --overwrite              Overwrite existing output files
  --info                   Print detected video info without downloading
  --quality <quality>      Preferred quality: best, 2k, 1080, 720, 540, 480, 360, lowest. Default: best
  --timeout <seconds>      Page/video detection timeout. Default: 180
  -h, --help               Show this help

Examples:
  douyin-downloader.exe https://www.douyin.com/video/7516025312329682217
  node douyin-downloader.mjs https://www.douyin.com/video/7516025312329682217
  node douyin-downloader.mjs "https://www.douyin.com/video/7516025312329682217" -o videos
  node douyin-downloader.mjs "https://www.douyin.com/video/7516025312329682217" -n "%title%_%id%.mp4"
`);
}

function parseArgs(argv) {
  const options = {
    outDir: process.cwd(),
    nameTemplate: '%title%_%id%.mp4',
    browser: null,
    showBrowser: false,
    keepProfile: false,
    overwrite: false,
    infoOnly: false,
    quality: 'best',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    urls: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-o' || arg === '--out') {
      options.outDir = argv[++i];
    } else if (arg === '-n' || arg === '--name') {
      options.nameTemplate = argv[++i];
    } else if (arg === '--browser') {
      options.browser = argv[++i];
    } else if (arg === '--show-browser') {
      options.showBrowser = true;
    } else if (arg === '--keep-profile') {
      options.keepProfile = true;
    } else if (arg === '--overwrite') {
      options.overwrite = true;
    } else if (arg === '--info') {
      options.infoOnly = true;
    } else if (arg === '--quality') {
      options.quality = String(argv[++i] || 'best').toLowerCase();
    } else if (arg === '--timeout') {
      const seconds = Number(argv[++i]);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new Error('--timeout must be a positive number of seconds');
      }
      options.timeoutMs = seconds * 1000;
    } else if (arg?.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options.urls.push(arg);
    }
  }

  if (!options.help && options.urls.length === 0) {
    throw new Error('Please provide at least one Douyin URL');
  }

  return options;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findBrowser(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.CHROME_PATH,
    process.env.EDGE_PATH,
  ];

  if (process.platform === 'win32') {
    candidates.push(
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
    );
  }

  for (const candidate of candidates.filter(Boolean)) {
    if (await exists(candidate)) {
      return candidate;
    }
  }

  throw new Error('Chrome/Edge was not found. Install Chrome/Edge or pass --browser <path>.');
}

async function getFreePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  server.close();
  await once(server, 'close');
  return port;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function reportLog(options, message) {
  options?.onLog?.(message);
  console.log(message);
}

function reportProgress(options, payload) {
  options?.onProgress?.(payload);
}

async function getJson(port, endpoint) {
  const response = await fetch(`http://127.0.0.1:${port}${endpoint}`);
  if (!response.ok) {
    throw new Error(`${endpoint} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function waitForPage(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const pages = await getJson(port, '/json/list');
      const page = pages.find((item) => item.type === 'page' && item.url.includes('douyin.com'))
        || pages.find((item) => item.type === 'page');
      if (page?.webSocketDebuggerUrl) {
        return page;
      }
    } catch {
      await sleep(500);
    }
    await sleep(500);
  }
  throw new Error('Timed out waiting for Chrome remote debugger');
}

function wsEncodeFrame(text) {
  const payload = Buffer.from(text);
  const length = payload.length;
  let header;

  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  header[0] = 0x81;
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    masked[i] = payload[i] ^ mask[i % 4];
  }

  return Buffer.concat([header, mask, masked]);
}

function tryDecodeWsMessage(buffer) {
  let offset = 0;
  const chunks = [];

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    let length = second & 0x7f;
    let headerLength = 2;

    if (length === 126) {
      if (offset + 4 > buffer.length) return null;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) return null;
      length = Number(buffer.readBigUInt64BE(offset + 2));
      headerLength = 10;
    }

    const masked = Boolean(second & 0x80);
    const maskLength = masked ? 4 : 0;
    const frameStart = offset + headerLength + maskLength;
    const frameEnd = frameStart + length;
    if (frameEnd > buffer.length) return null;

    let payload = buffer.subarray(frameStart, frameEnd);
    if (masked) {
      const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
      payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
    }

    if (opcode === 0x8) {
      throw new Error('WebSocket closed before CDP response');
    }
    if (opcode === 0x1 || opcode === 0x0) {
      chunks.push(payload);
      if (first & 0x80) {
        return Buffer.concat(chunks).toString('utf8');
      }
    }
    offset = frameEnd;
  }

  return null;
}

async function cdp(wsUrl, method, params = {}, timeoutMs = 30_000) {
  const payload = JSON.stringify({
    id: 1,
    method,
    params,
  });
  try {
    return await cdpViaRawSocket(wsUrl, payload, method, timeoutMs);
  } catch (error) {
    if (/ECONNRESET|ECONNREFUSED|WebSocket closed/i.test(String(error?.message || error))) {
      await sleep(400);
      return cdpViaRawSocket(wsUrl, payload, method, timeoutMs);
    }
    throw error;
  }
}

async function cdpViaRawSocket(wsUrl, payload, method, timeoutMs) {
  return new Promise((resolve, reject) => {
    const target = new URL(wsUrl);
    const socket = createConnection(Number(target.port), target.hostname);
    const key = crypto.randomBytes(16).toString('base64');
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`CDP command timed out: ${method}`));
    }, timeoutMs);

    let buffer = Buffer.alloc(0);
    let handshakeDone = false;

    socket.on('connect', () => {
      socket.write([
        `GET ${target.pathname}${target.search} HTTP/1.1`,
        `Host: ${target.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '\r\n',
      ].join('\r\n'));
    });

    socket.on('data', (chunk) => {
      try {
        buffer = Buffer.concat([buffer, chunk]);
        if (!handshakeDone) {
          const end = buffer.indexOf('\r\n\r\n');
          if (end === -1) return;
          const header = buffer.subarray(0, end).toString('utf8');
          if (!header.includes(' 101 ')) {
            throw new Error('Chrome rejected WebSocket handshake');
          }
          handshakeDone = true;
          buffer = buffer.subarray(end + 4);
          socket.write(wsEncodeFrame(payload));
        }

        const text = tryDecodeWsMessage(buffer);
        if (!text) return;
        const message = JSON.parse(text);
        if (message.id !== 1) return;
        clearTimeout(timer);
        socket.end();
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      } catch (error) {
        clearTimeout(timer);
        socket.destroy();
        reject(error);
      }
    });

    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function sanitizeFilePart(value, fallback = 'untitled', maxLength = 120) {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+$/, '');

  return (cleaned || fallback).slice(0, maxLength);
}

function extractDouyinId(...values) {
  for (const value of values) {
    const text = String(value || '');
    const fromMediaPath = text.match(/\/(?:video|note)\/(\d{10,})/);
    if (fromMediaPath) return fromMediaPath[1];
    const fromQuery = text.match(/[?&](?:__vid|modal_id|aweme_id|item_id)=(\d{10,})/);
    if (fromQuery) return fromQuery[1];
  }
  return '';
}

function extractDouyinUrls(value) {
  const text = String(value || '').trim();
  if (!text) return [];

  const candidates = text.match(/https?:\/\/[^\s<>"']+/giu) || [text];
  const urls = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const cleaned = String(candidate || '')
      .trim()
      .replace(/[，。；！、）】》]+$/gu, '');
    try {
      const parsed = new URL(cleaned);
      const host = parsed.hostname.toLowerCase();
      if (host !== 'douyin.com' && !host.endsWith('.douyin.com')) continue;
      if (seen.has(parsed.href)) continue;
      seen.add(parsed.href);
      urls.push(parsed.href);
    } catch {}
  }
  return urls;
}

function guessId(...values) {
  const id = extractDouyinId(...values);
  if (id) return id;
  return crypto.randomUUID().slice(0, 8);
}

function normalizeDouyinUrl(url) {
  const extracted = extractDouyinUrls(url);
  const inputUrl = extracted[0] || String(url || '').trim();
  try {
    const parsed = new URL(inputUrl);
    if (!parsed.hostname.endsWith('douyin.com')) return inputUrl;

    const awemeId = extractDouyinId(inputUrl);
    if (awemeId) {
      return `https://www.douyin.com/video/${awemeId}`;
    }
  } catch {}

  return inputUrl;
}

async function resolveDouyinUrl(url, timeoutMs = 10_000) {
  const normalized = normalizeDouyinUrl(url);
  try {
    const parsed = new URL(normalized);
    if (parsed.hostname.toLowerCase() !== 'v.douyin.com') return normalized;

    const response = await fetch(normalized, {
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(Math.min(Math.max(Number(timeoutMs) || 10_000, 2000), 15_000)),
    });
    const location = response.headers.get('location');
    await response.body?.cancel().catch(() => {});
    if (!location) return normalized;

    const redirectedUrl = new URL(location, normalized).href;
    return normalizeDouyinUrl(redirectedUrl);
  } catch {
    return normalized;
  }
}

function shouldShowBrowser(options = {}) {
  return Boolean(options.showBrowser || options.douyinSession);
}

function stripDouyinSuffix(title) {
  return String(title || '').replace(/\s*-\s*抖音\s*$/u, '').trim();
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

  throw new Error(`Could not find a free file name for ${filePath}`);
}

function buildOutputFileName(template, info) {
  const date = new Date().toISOString().slice(0, 10);
  const title = sanitizeFilePart(stripDouyinSuffix(info.title), 'douyin', 80);
  const id = sanitizeFilePart(info.id, 'video');
  const fileName = template
    .replaceAll('%id%', id)
    .replaceAll('%title%', title)
    .replaceAll('%date%', date);

  const safeFileName = sanitizeFilePart(fileName, `douyin_${id}.mp4`);
  return path.extname(safeFileName) ? safeFileName : `${safeFileName}.mp4`;
}

function buildOutputPath(outDir, template, info, overwrite) {
  return getUniquePath(path.resolve(outDir, buildOutputFileName(template, info)), overwrite);
}

async function buildPhotoOutputPath(outDir, template, info, overwrite) {
  const parsed = path.parse(path.resolve(outDir, buildOutputFileName(template, info)));
  for (let index = 0; index < 1000; index += 1) {
    const baseName = index === 0 ? parsed.name : `${parsed.name}_${index}`;
    const materialDir = path.join(parsed.dir, baseName);
    if (!overwrite && await exists(materialDir)) continue;

    await mkdir(materialDir, { recursive: true });
    return path.join(materialDir, `${baseName}${parsed.ext || '.mp4'}`);
  }

  throw new Error(`Could not find a free folder name for ${parsed.name}`);
}

function buildCookieHeader(cookies, mediaUrl) {
  const target = new URL(mediaUrl);
  return cookies
    .filter((cookie) => {
      const domain = String(cookie.domain || '').replace(/^\./, '');
      return target.hostname === domain || target.hostname.endsWith(`.${domain}`);
    })
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

async function getVideoInfo(page, timeoutMs, expectedId = '') {
  const expectedIdLiteral = JSON.stringify(String(expectedId || ''));
  const expression = `(() => {
    const expectedId = ${expectedIdLiteral};
    const href = location.href;
    if (expectedId && !href.includes(expectedId)) {
      return {
        href,
        title: document.title,
        src: '',
        reason: 'waiting for target video page'
      };
    }
    const media = [];
    for (const video of document.querySelectorAll('video')) {
      try { video.muted = true; video.play && video.play().catch(() => {}); } catch {}
      media.push({
        src: video.currentSrc || video.src || '',
        duration: Number.isFinite(video.duration) ? video.duration : null,
        readyState: video.readyState,
        videoWidth: video.videoWidth || 0,
        videoHeight: video.videoHeight || 0
      });
    }
    for (const source of document.querySelectorAll('source[src]')) {
      media.push({ src: source.src, duration: null, readyState: null });
    }
    for (const entry of performance.getEntriesByType('resource')) {
      media.push({
        src: entry.name || '',
        duration: null,
        readyState: null,
        source: 'performance'
      });
    }
    const scored = media
      .filter((item) => /^https?:\\/\\//.test(item.src || ''))
      .map((item) => {
        let score = 0;
        if (/__vid=\\d{10,}/.test(item.src)) score += 100;
        if (/douyinvod\\.com/.test(item.src)) score += 90;
        if (/mime_type=video_mp4/.test(item.src)) score += 40;
        if (/[?&]ch=26(?:&|$)/.test(item.src)) score += 30;
        if (/\\/aweme\\/v1\\/play\\//.test(item.src)) score += 80;
        if (item.videoWidth && item.videoHeight) score += 80;
        if (item.duration && item.duration > 5 && item.videoWidth && item.videoHeight) score += 20;
        if (/\\/media-video-[^/]+\\//.test(item.src)) score -= 1000;
        if (/\\/media-audio-[^/]+\\//.test(item.src)) score -= 1000;
        if (/\\/uuu_\\d+\\.mp4(?:\\?|$)/.test(item.src)) score -= 1000;
        if (/douyinstatic\\.com\\/obj\\/douyin-pc-web/.test(item.src)) score -= 100;
        return { ...item, score };
      })
      .sort((a, b) => b.score - a.score);
    const source = scored.find((item) => item.score > 0);
    return {
      href,
      title: document.title,
      src: source ? source.src : '',
      duration: source ? source.duration : null,
      readyState: source ? source.readyState : null,
      candidates: scored.slice(0, 5).map((item) => ({
        src: item.src,
        duration: item.duration,
        readyState: item.readyState,
        videoWidth: item.videoWidth || 0,
        videoHeight: item.videoHeight || 0,
        source: item.source || 'dom',
        score: item.score
      })),
      text: document.body ? document.body.innerText.slice(0, 500) : ''
    };
  })()`;

  const deadline = Date.now() + timeoutMs;
  let lastInfo = null;

  while (Date.now() < deadline) {
    const result = await cdp(page.webSocketDebuggerUrl, 'Runtime.evaluate', {
      returnByValue: true,
      expression,
    });
    lastInfo = result.result.value;
    if (lastInfo?.src) {
      return {
        ...lastInfo,
        id: guessId(lastInfo.href, lastInfo.src),
      };
    }
    await sleep(1000);
  }

  const title = lastInfo?.title ? ` Last page title: ${lastInfo.title}` : '';
  throw new Error(`Could not find a video source before timeout.${title}`);
}

async function getPhotoNoteInfo(page, timeoutMs, expectedId = '') {
  const expectedIdLiteral = JSON.stringify(String(expectedId || ''));
  const expression = `(() => {
    const expectedId = ${expectedIdLiteral};
    const roots = [];
    const renderText = document.getElementById('RENDER_DATA')?.textContent || '';
    if (renderText) {
      try { roots.push(JSON.parse(decodeURIComponent(renderText))); } catch {}
    }

    const pushPacePayload = (payloadValue) => {
      try {
        const payload = typeof payloadValue === 'string' ? payloadValue.trim() : '';
        const separator = payload.indexOf(':');
        const jsonText = /^\\d+:/.test(payload) ? payload.slice(separator + 1) : payload;
        if (jsonText.startsWith('{') || jsonText.startsWith('[')) roots.push(JSON.parse(jsonText));
      } catch {}
    };
    if (Array.isArray(window.__pace_f)) {
      for (const entry of window.__pace_f) pushPacePayload(entry?.[1]);
    }

    for (const script of document.scripts) {
      const text = (script.textContent || '').trim();
      if (!text.includes('self.__pace_f.push') || (expectedId && !text.includes(expectedId))) continue;
      try {
        const arrayStart = text.indexOf('[', text.indexOf('self.__pace_f.push'));
        const arrayEnd = text.lastIndexOf(']');
        if (arrayStart < 0 || arrayEnd <= arrayStart) continue;
        const args = JSON.parse(text.slice(arrayStart, arrayEnd + 1));
        pushPacePayload(args?.[1]);
      } catch {}
    }

    const objectId = (value) => String(
      value?.awemeId || value?.aweme_id || value?.groupId || value?.group_id || ''
    );
    const candidates = [];
    const seen = new Set();
    const walk = (value) => {
      if (!value || typeof value !== 'object' || seen.has(value) || candidates.length > 50) return;
      seen.add(value);
      if ((!expectedId || objectId(value) === expectedId) && objectId(value)) candidates.push(value);
      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') walk(child);
      }
    };
    for (const root of roots) walk(root);

    const addressUrls = (value) => {
      if (!value || typeof value !== 'object') return [];
      const direct = value.urlList || value.url_list || value.downloadUrlList || value.download_url_list;
      if (Array.isArray(direct)) return direct.filter((item) => /^https?:\\/\\//.test(item || ''));
      return [];
    };
    const imageInfo = (item) => {
      const addresses = [
        item?.originImage,
        item?.origin_image,
        item?.displayImage,
        item?.display_image,
        item?.downloadImage,
        item?.download_image,
        item,
      ].filter(Boolean);
      let urls = [];
      for (const address of addresses) {
        urls = addressUrls(address);
        if (urls.length) break;
      }
      if (!urls.length) return null;
      const dimensions = addresses.find((address) => address?.width || address?.height) || item || {};
      return {
        src: urls[0],
        alternatives: urls,
        width: Number(dimensions.width || item?.width) || 0,
        height: Number(dimensions.height || item?.height) || 0,
      };
    };
    const musicUrl = (music) => {
      const addresses = [music?.playUrl, music?.play_url, music?.playAddr, music?.play_addr, music];
      for (const address of addresses) {
        const urls = addressUrls(address);
        if (urls.length) return urls[0];
      }
      return '';
    };

    const domImages = [...document.images]
      .map((image) => ({
        src: image.currentSrc || image.src || '',
        width: Number(image.naturalWidth || image.width) || 0,
        height: Number(image.naturalHeight || image.height) || 0,
      }))
      .filter((image) => /^https?:\\/\\//.test(image.src)
        && image.width >= 400
        && image.height >= 400
        && !/aweme-avatar|avatar|emoji|logo/i.test(image.src));
    const uniqueDomImages = [...new Map(domImages.map((image) => [image.src, image])).values()];
    const pageText = document.body?.innerText || '';
    const counterMatch = pageText.match(/(?:^|\\s)(\\d{1,2})\\/(\\d{1,2})(?:\\s|$)/);
    const expectedImageCount = Number(counterMatch?.[2]) || 0;
    if (/\\/note\\//.test(location.pathname)
      && uniqueDomImages.length
      && (!expectedImageCount || uniqueDomImages.length >= expectedImageCount)) {
      const media = [...document.querySelectorAll('video, audio')]
        .map((item) => ({
          src: item.currentSrc || item.src || '',
          duration: Number.isFinite(item.duration) ? item.duration : 0,
        }))
        .find((item) => /^https?:\\/\\//.test(item.src));
      return {
        href: location.href,
        title: document.title,
        id: expectedId,
        kind: 'photo',
        source: 'photo_note_dom',
        images: uniqueDomImages.slice(0, expectedImageCount || uniqueDomImages.length),
        audioSrc: media?.src || '',
        duration: media?.duration || 0,
        expectedImageCount,
      };
    }

    for (const rawCandidate of candidates) {
      const nestedCandidates = [
        rawCandidate?.detail,
        rawCandidate?.aweme?.detail,
        rawCandidate?.awemeDetail,
        rawCandidate?.aweme_detail,
        rawCandidate,
      ].filter(Boolean);
      const candidate = nestedCandidates.find((item) => !expectedId || objectId(item) === expectedId)
        || rawCandidate;
      const postInfo = candidate.imagePostInfo || candidate.image_post_info || {};
      const imageLists = [
        candidate.images,
        postInfo.images,
        postInfo.imageList,
        postInfo.image_list,
      ];
      const rawImages = imageLists.find((items) => Array.isArray(items) && items.length) || [];
      const images = rawImages.map(imageInfo).filter(Boolean);
      if (!images.length) continue;
      const music = candidate.music || postInfo.music || {};
      let duration = Number(candidate.duration || music.duration || 0) || 0;
      if (duration > 1000) duration /= 1000;
      return {
        href: location.href,
        title: candidate.desc || candidate.itemTitle || document.title,
        id: objectId(candidate) || expectedId,
        kind: 'photo',
        source: 'photo_note',
        images,
        audioSrc: musicUrl(music),
        duration,
        awemeType: candidate.awemeType || candidate.aweme_type || null,
      };
    }

    return {
      href: location.href,
      title: document.title,
      kind: '',
      reason: 'photo note data was not found yet',
      rootCount: roots.length,
      candidateCount: candidates.length,
      domImageCount: uniqueDomImages.length,
      expectedImageCount,
    };
  })()`;

  const deadline = Date.now() + timeoutMs;
  let lastInfo = null;
  while (Date.now() < deadline) {
    const result = await cdp(page.webSocketDebuggerUrl, 'Runtime.evaluate', {
      returnByValue: true,
      expression,
    });
    lastInfo = result.result.value;
    if (lastInfo?.kind === 'photo' && lastInfo.images?.length) return lastInfo;
    await sleep(1000);
  }
  const reason = lastInfo?.reason
    ? ` Last photo check: ${lastInfo.reason} (${lastInfo.rootCount || 0} roots, ${lastInfo.candidateCount || 0} candidates, ${lastInfo.domImageCount || 0}/${lastInfo.expectedImageCount || '?'} DOM images)`
    : '';
  throw new Error(`Could not find photo note data before timeout.${reason}`);
}

async function getDouyinInfoFromSharePage(expectedId, timeoutMs = 15_000, quality = 'best') {
  const id = String(expectedId || '').trim();
  if (!/^\d{10,}$/.test(id)) throw new Error('Douyin share item ID was not available');
  let html = '';
  let item = null;
  let lastError = null;
  for (const kind of ['note', 'video']) {
    const shareUrl = `https://www.iesdouyin.com/share/${kind}/${id}`;
    try {
      const response = await fetch(shareUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36',
          Referer: 'https://www.douyin.com/',
        },
        signal: AbortSignal.timeout(Math.min(Math.max(timeoutMs / 2, 3000), 10_000)),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      html = await response.text();
      const match = html.match(/<script[^>]*>\s*window\._ROUTER_DATA\s*=\s*([\s\S]*?)<\/script>/i);
      if (!match) throw new Error('router data was not found');
      const routerData = JSON.parse(match[1].trim().replace(/;\s*$/, ''));
      const pageData = Object.values(routerData?.loaderData || {})
        .find((entry) => Array.isArray(entry?.videoInfoRes?.item_list));
      item = pageData?.videoInfoRes?.item_list
        ?.find((entry) => String(entry?.aweme_id || '') === id)
        || pageData?.videoInfoRes?.item_list?.[0]
        || null;
      if (item) break;
      throw new Error('item data was not found');
    } catch (error) {
      lastError = error;
    }
  }
  if (!item) throw new Error(`Douyin share page failed: ${lastError?.message || 'unknown error'}`);
  const rawImages = Array.isArray(item?.images) ? item.images : [];
  const images = rawImages.map((image) => {
    const urls = Array.isArray(image?.url_list) ? image.url_list.filter(Boolean) : [];
    return {
      src: urls[0] || '',
      alternatives: urls,
      width: Number(image?.width) || 0,
      height: Number(image?.height) || 0,
    };
  }).filter((image) => /^https?:\/\//.test(image.src));
  if (images.length) {
    const directAudio = String(item?.video?.play_addr?.uri || '');
    const audioMatch = html.match(/<audio[^>]+src=["']([^"']+)["']/i);
    return {
      href: `https://www.douyin.com/note/${id}`,
      title: item?.desc || `douyin_note_${id}`,
      id,
      kind: 'photo',
      source: 'photo_note_share',
      images,
      audioSrc: /^https?:\/\//.test(directAudio) ? directAudio : (audioMatch?.[1] || '').replace(/&amp;/g, '&'),
      duration: Number(item?.music?.duration) || 0,
      awemeType: item?.aweme_type || null,
    };
  }

  const rawPlayUrl = item?.video?.play_addr?.url_list?.[0] || '';
  if (!/^https?:\/\//.test(rawPlayUrl)) throw new Error('The Douyin share page did not contain a playable video URL');
  const originalWidth = Number(item?.video?.width) || 0;
  const originalHeight = Number(item?.video?.height) || 0;
  const originalDimension = originalWidth && originalHeight
    ? Math.min(originalWidth, originalHeight)
    : Math.max(originalWidth, originalHeight);
  const maxDimension = Math.min(originalDimension || 1080, 1080);
  const qualityDimensions = [...new Set([maxDimension, 720, 480]
    .filter((dimension) => dimension > 0 && dimension <= maxDimension))]
    .sort((a, b) => b - a);
  const qualityKey = String(quality || 'best').toLowerCase();
  const requestedTarget = douyinTargetQuality(qualityKey);
  const target = qualityKey === 'lowest'
    ? qualityDimensions[qualityDimensions.length - 1]
    : Math.min(requestedTarget || maxDimension, maxDimension);
  const buildPlayUrl = (dimension) => {
    const parsed = new URL(rawPlayUrl.replace('/playwm/', '/play/'));
    parsed.searchParams.set('ratio', `${dimension}p`);
    return parsed.href;
  };
  const dimensions = (dimension) => originalWidth <= originalHeight
    ? { width: dimension, height: originalWidth ? Math.round(dimension * originalHeight / originalWidth) : Math.round(dimension * 16 / 9) }
    : { width: originalHeight ? Math.round(dimension * originalWidth / originalHeight) : Math.round(dimension * 16 / 9), height: dimension };
  const qualityOptions = qualityDimensions
    .map((dimension) => ({
      src: buildPlayUrl(dimension),
      source: 'share_play',
      dimension,
      ...dimensions(dimension),
    }));
  const selected = [...qualityOptions].sort((a, b) => (
    Math.abs(a.dimension - target) - Math.abs(b.dimension - target)
    || (a.dimension < target ? 1 : 0) - (b.dimension < target ? 1 : 0)
  ))[0];
  await sleep(Math.min(8000, Math.max(2000, timeoutMs / 3)));
  return {
    href: `https://www.douyin.com/video/${id}`,
    title: item?.desc || `douyin_${id}`,
    id,
    src: selected.src,
    source: selected.source,
    width: selected.width,
    height: selected.height,
    duration: Number(item?.video?.duration) > 1000 ? Number(item.video.duration) / 1000 : Number(item?.video?.duration) || 0,
    availableQualities: qualityOptions,
    awemeType: item?.aweme_type || null,
  };
}

async function getAwemeDetailInfo(page, timeoutMs, quality = 'best', expectedId = '') {
  const qualityPreference = JSON.stringify(String(quality || 'best').toLowerCase());
  const expectedIdLiteral = JSON.stringify(String(expectedId || ''));
  const expression = `(() => (async () => {
    try {
      const qualityPreference = ${qualityPreference};
      const expectedId = ${expectedIdLiteral};
      const detailUrl = performance.getEntriesByType('resource')
        .map((entry) => entry.name || '')
        .reverse()
        .find((url) => /\\/aweme\\/v1\\/web\\/aweme\\/detail\\//.test(url) && (!expectedId || url.includes(expectedId)));
      if (!detailUrl) {
        return { src: '', reason: expectedId ? 'target aweme detail request was not found yet' : 'aweme detail request was not found yet' };
      }

      const response = await fetch(detailUrl, { credentials: 'include' });
      if (!response.ok) {
        return { src: '', reason: 'aweme detail returned HTTP ' + response.status };
      }

      const json = await response.json();
      const aweme = json.aweme_detail || json.aweme || json.data?.aweme_detail;
      const awemeIds = [aweme?.aweme_id, aweme?.group_id]
        .map((item) => String(item || ''))
        .filter(Boolean);
      const awemeId = awemeIds[0] || '';
      if (expectedId && awemeIds.length && !awemeIds.includes(expectedId)) {
        return { src: '', reason: 'waiting for target aweme detail; current aweme id is ' + awemeIds.join(',') };
      }
      const video = aweme?.video || {};
      const addresses = [];
      const pushAddress = (address, source, meta = {}) => {
        for (const src of address?.url_list || []) {
          addresses.push({
            src,
            source,
            width: address.width || null,
            height: address.height || null,
            dataSize: address.data_size || null,
            bitRate: meta.bitRate || null,
            gearName: meta.gearName || '',
            qualityType: meta.qualityType || null
          });
        }
      };

      pushAddress(video.play_addr, 'play_addr');
      pushAddress(video.play_addr_h264, 'play_addr_h264');
      for (const item of video.bit_rate || []) {
        pushAddress(item.play_addr, 'bit_rate.' + (item.gear_name || item.quality_type || 'unknown'), {
          bitRate: item.bit_rate,
          gearName: item.gear_name,
          qualityType: item.quality_type
        });
      }
      pushAddress(video.download_addr, 'download_addr');
      if (video.misc_download_addrs) {
        try {
          const misc = JSON.parse(video.misc_download_addrs);
          for (const [name, address] of Object.entries(misc || {})) {
            pushAddress(address, 'misc_download_addrs.' + name);
          }
        } catch {}
      }

      const isUsable = (item) => /^https?:\\/\\//.test(item.src || '') && !/\\/media-audio-[^/]+\\//.test(item.src);
      const isSplitVideo = (item) => /\\/media-video-[^/]+\\//.test(item.src || '');
      const isMuxedSource = (item) => ['play_addr', 'play_addr_h264', 'download_addr'].includes(item.source) && !isSplitVideo(item);
      const dimension = (item) => {
        const width = Number(item.width) || 0;
        const height = Number(item.height) || 0;
        return width && height ? Math.min(width, height) : Math.max(width, height);
      };
      const pixels = (item) => (Number(item.width) || 0) * (Number(item.height) || 0);
      const sourceRank = (item) => {
        if (item.source === 'play_addr') return 0;
        if (item.source === 'play_addr_h264') return 1;
        if (item.source.startsWith('bit_rate.')) return 2;
        if (item.source === 'download_addr') return 5;
        return 6;
      };
      const muxedPool = addresses.filter((item) => isUsable(item) && isMuxedSource(item));
      const cleanPool = addresses.filter((item) => isUsable(item) && !isSplitVideo(item));
      const fallbackPool = addresses.filter(isUsable);
      const pool = muxedPool.length ? muxedPool : (cleanPool.length ? cleanPool : fallbackPool);
      const targetMap = { '2k': 1440, '1440': 1440, '1080': 1080, '1080p': 1080, '720': 720, '720p': 720, '540': 540, '540p': 540, '480': 480, '480p': 480, '360': 360, '360p': 360 };
      const target = targetMap[qualityPreference]
        || (/^\\d{3,4}p?$/.test(qualityPreference) ? Number(qualityPreference.replace(/p$/, '')) : null);
      const byBest = (a, b) => pixels(b) - pixels(a)
        || dimension(b) - dimension(a)
        || sourceRank(a) - sourceRank(b)
        || (Number(b.bitRate) || 0) - (Number(a.bitRate) || 0)
        || (Number(b.dataSize) || 0) - (Number(a.dataSize) || 0);
      const byLowest = (a, b) => (Number(a.dataSize) || Number.MAX_SAFE_INTEGER) - (Number(b.dataSize) || Number.MAX_SAFE_INTEGER)
        || pixels(a) - pixels(b)
        || sourceRank(a) - sourceRank(b);
      const byTarget = (a, b) => Math.abs(dimension(a) - target) - Math.abs(dimension(b) - target)
        || (dimension(a) < target ? 1 : 0) - (dimension(b) < target ? 1 : 0)
        || sourceRank(a) - sourceRank(b)
        || (Number(b.bitRate) || 0) - (Number(a.bitRate) || 0)
        || (Number(b.dataSize) || 0) - (Number(a.dataSize) || 0);
      const source = [...pool].sort(qualityPreference === 'lowest' ? byLowest : target ? byTarget : byBest)[0];
      const qualityOptions = [...new Map(pool
        .filter((item) => dimension(item))
        .sort(byBest)
        .map((item) => [dimension(item), {
          src: item.src,
          width: item.width,
          height: item.height,
          dimension: dimension(item),
          source: item.source,
          bitRate: item.bitRate,
          dataSize: item.dataSize
        }])).values()];
      if (!source) {
        return { src: '', reason: 'aweme detail did not contain a usable media URL' };
      }

      return {
        href: location.href,
        title: document.title,
        src: source.src,
        duration: video.duration ? video.duration / 1000 : null,
        readyState: null,
        source: source.source,
        width: source.width,
        height: source.height,
        dataSize: source.dataSize,
        bitRate: source.bitRate,
        selectedQuality: qualityPreference,
        availableQualities: qualityOptions,
        awemeId
      };
    } catch (error) {
      return { src: '', reason: error?.message || String(error) };
    }
  })())()`;

  const deadline = Date.now() + timeoutMs;
  let lastInfo = null;

  while (Date.now() < deadline) {
    const result = await cdp(page.webSocketDebuggerUrl, 'Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression,
    });
    lastInfo = result.result.value;
    if (lastInfo?.src) {
      return {
        ...lastInfo,
        id: guessId(lastInfo.href, lastInfo.src, lastInfo.awemeId),
      };
    }
    await sleep(1000);
  }

  const reason = lastInfo?.reason ? ` Last detail check: ${lastInfo.reason}` : '';
  throw new Error(`Could not find an aweme detail media URL before timeout.${reason}`);
}

async function resolveDouyinVideoInfo(page, timeoutMs, quality = 'best', expectedId = '') {
  const fallbackDelayMs = Math.min(10_000, Math.max(2_000, Math.floor(timeoutMs / 3)));
  const fallbackTimeoutMs = Math.max(5_000, timeoutMs - fallbackDelayMs);
  try {
    return await Promise.any([
      getDouyinInfoFromSharePage(expectedId, Math.min(timeoutMs, 15_000), quality),
      getAwemeDetailInfo(page, timeoutMs, quality, expectedId),
      sleep(1500).then(() => getPhotoNoteInfo(page, fallbackTimeoutMs, expectedId)),
      sleep(fallbackDelayMs).then(() => getVideoInfo(page, fallbackTimeoutMs, expectedId)),
    ]);
  } catch (error) {
    const messages = Array.isArray(error?.errors)
      ? error.errors.map((item) => item?.message || String(item)).filter(Boolean)
      : [error?.message || String(error)];
    throw new Error(messages.join(' | '));
  }
}

async function resetDouyinPageForSwitch(page) {
  if (!page?.webSocketDebuggerUrl) return;
  await cdp(page.webSocketDebuggerUrl, 'Page.stopLoading').catch(() => {});
  await cdp(page.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression: `(() => {
      try { window.stop(); } catch {}
      try { performance.clearResourceTimings(); } catch {}
    })()`,
  }).catch(() => {});
}

async function downloadToFileOnce(info, outputPath, pageUrl, cookies, options = {}) {
  if (options.signal?.aborted) {
    throw new Error('任务已终止');
  }
  const mediaHost = (() => {
    try {
      return new URL(info.src).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  const omitReferer = mediaHost === 'aweme.snssdk.com'
    || mediaHost.endsWith('.douyinvod.com')
    || mediaHost.endsWith('.bytevcloud.com')
    || mediaHost.endsWith('.qrstuvwxyzab.com');
  const headers = {
    'User-Agent': USER_AGENT,
    Range: 'bytes=0-',
  };
  if (!omitReferer) headers.Referer = info.href || pageUrl;
  const cookieHeader = buildCookieHeader(cookies, info.src);
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  const response = await fetch(info.src, { headers, signal: options.signal });
  if (!response.ok && response.status !== 206) {
    const error = new Error(`Video request returned HTTP ${response.status}`);
    error.douyinMediaDownload = true;
    error.httpStatus = response.status;
    throw error;
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Error('Video request returned HTML instead of media');
  }
  if (!response.body) {
    throw new Error('Video response had no body');
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
        const percent = ((downloaded / total) * 100).toFixed(1);
        reportProgress(options, {
          downloaded,
          total,
          percent: Number(percent),
          outputPath,
        });
        process.stdout.write(`  ${percent}% (${downloaded}/${total} bytes)\r`);
      }
    }
  } finally {
    file.end();
    await once(file, 'finish');
  }

  if (total) {
    reportProgress(options, {
      downloaded,
      total,
      percent: 100,
      outputPath,
    });
    process.stdout.write(' '.repeat(60) + '\r');
  }
  return stat(outputPath);
}

async function downloadToFile(info, outputPath, pageUrl, cookies, options = {}) {
  const maxAttempts = Math.max(1, Number(options.downloadAttempts) || 3);
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await downloadToFileOnce(info, outputPath, pageUrl, cookies, options);
    } catch (error) {
      lastError = error;
      await rm(outputPath, { force: true }).catch(() => {});
      if (options.signal?.aborted || /任务已终止|aborted|abort/i.test(String(error?.message || error))) {
        throw error;
      }
      if (attempt >= maxAttempts) break;
      reportLog(options, `  媒体连接中断，正在重试（${attempt}/${maxAttempts - 1}）...`);
      await sleep(500 * attempt);
    }
  }
  if (lastError && typeof lastError === 'object') {
    lastError.douyinMediaDownload = true;
  }
  throw lastError;
}

function isPhotoNoteInfo(info) {
  return info?.kind === 'photo' && Array.isArray(info.images) && info.images.length > 0;
}

async function runPhotoSlideshowFfmpeg(ffmpegPath, imagePaths, audioPath, duration, outputPath, options = {}) {
  const totalDuration = Math.max(Number(duration) || imagePaths.length * 3, imagePaths.length);
  const imageDuration = totalDuration / imagePaths.length;
  const args = ['-hide_banner', '-loglevel', 'warning', '-y'];
  for (const imagePath of imagePaths) {
    args.push('-loop', '1', '-framerate', '30', '-t', imageDuration.toFixed(3), '-i', imagePath);
  }
  if (audioPath) args.push('-i', audioPath);

  const filters = imagePaths.map((_, index) => (
    `[${index}:v]scale=1080:1920:force_original_aspect_ratio=decrease,`
    + 'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,'
    + `setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[v${index}]`
  ));
  filters.push(`${imagePaths.map((_, index) => `[v${index}]`).join('')}concat=n=${imagePaths.length}:v=1:a=0[vout]`);
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[vout]',
  );
  if (audioPath) {
    args.push('-map', `${imagePaths.length}:a:0?`, '-c:a', 'aac', '-b:a', '192k', '-shortest');
  } else {
    args.push('-an', '-t', totalDuration.toFixed(3));
  }
  args.push(
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-movflags', '+faststart',
    outputPath,
  );

  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const abort = () => {
      proc.kill();
      reject(new Error('任务已终止'));
    };
    if (options.signal?.aborted) return abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    proc.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-12_000);
    });
    proc.on('error', (error) => {
      options.signal?.removeEventListener('abort', abort);
      reject(error);
    });
    proc.on('exit', (code) => {
      options.signal?.removeEventListener('abort', abort);
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg 合成抖音图文视频失败（退出码 ${code}）：${stderr.trim()}`));
    });
  });
}

async function downloadPhotoNote(info, outputPath, pageUrl, cookies, options = {}) {
  const ffmpegPath = await findFfmpeg(options.ffmpegPath);
  if (!ffmpegPath) throw new Error('该抖音作品是图文相册，需要 FFmpeg 才能合成为视频。');
  const tempDir = await makeTempDir(`douyin-photo-${info.id || 'note'}`);
  const imagePaths = [];
  let audioPath = '';
  try {
    reportLog(options, `  检测到抖音图文作品：${info.images.length} 张图片，正在合成为视频。`);
    for (let index = 0; index < info.images.length; index += 1) {
      const image = info.images[index];
      const imagePath = path.join(tempDir, `image-${String(index + 1).padStart(2, '0')}.webp`);
      const urls = [...new Set([image.src, ...(image.alternatives || [])].filter(Boolean))];
      let lastError = null;
      for (const src of urls) {
        try {
          await downloadToFile({ src, href: info.href || pageUrl }, imagePath, pageUrl, cookies, {
            ...options,
            onProgress: (payload) => {
              const localPercent = Number(payload.percent) || 0;
              reportProgress(options, {
                ...payload,
                percent: 5 + ((index + localPercent / 100) / info.images.length) * 55,
              });
            },
          });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (lastError) throw new Error(`第 ${index + 1} 张图片下载失败：${lastError.message}`);
      imagePaths.push(imagePath);
    }

    if (info.audioSrc) {
      audioPath = path.join(tempDir, 'background-audio.m4a');
      await downloadToFile({ src: info.audioSrc, href: info.href || pageUrl }, audioPath, pageUrl, cookies, {
        ...options,
        onProgress: (payload) => reportProgress(options, {
          ...payload,
          percent: 60 + (Number(payload.percent) || 0) * 0.2,
        }),
      });
    }

    reportProgress(options, { percent: 82, outputPath });
    reportLog(options, '  图片和背景音乐下载完成，正在生成相册视频...');
    await runPhotoSlideshowFfmpeg(
      ffmpegPath,
      imagePaths,
      audioPath,
      info.duration,
      outputPath,
      options,
    );
    reportProgress(options, { percent: 94, outputPath });
    const materialDir = path.dirname(outputPath);
    for (let index = 0; index < imagePaths.length; index += 1) {
      const imageName = `图片_${String(index + 1).padStart(2, '0')}.webp`;
      await copyFile(imagePaths[index], path.join(materialDir, imageName));
      reportProgress(options, {
        percent: 94 + ((index + 1) / imagePaths.length) * 5,
        outputPath,
      });
    }
    reportLog(options, `  图文作品已整理到：${materialDir}`);
    reportProgress(options, { percent: 100, outputPath });
    return stat(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function startBrowser(browserPath, port, profileDir, showBrowser, initialUrl = 'about:blank') {
  await mkdir(profileDir, { recursive: true });
  const args = [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileDir}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
  ];
  if (!showBrowser) {
    args.push('--headless=new');
  }
  args.push(initialUrl || 'about:blank');

  return spawn(browserPath, args, {
    stdio: 'ignore',
    windowsHide: !showBrowser,
  });
}

async function stopBrowser(proc, page = null) {
  if (!proc || proc.killed) return;
  if (page?.webSocketDebuggerUrl) {
    await cdp(page.webSocketDebuggerUrl, 'Browser.close', {}, 1500).catch(() => {});
  }
  if (proc.exitCode !== null) return;
  await Promise.race([
    once(proc, 'exit'),
    sleep(1500),
  ]).catch(() => {});
  if (proc.exitCode !== null) return;
  proc.kill();
  await Promise.race([
    once(proc, 'exit'),
    sleep(3000),
  ]).catch(() => {});
}

async function createDouyinSession(browserPath, options = {}) {
  const port = await getFreePort();
  const temporaryProfile = !options.profileDir;
  const profileDir = options.profileDir
    ? path.resolve(options.profileDir)
    : await makeTempDir('douyin-downloader-batch');
  const proc = await startBrowser(
    browserPath,
    port,
    profileDir,
    true,
    options.initialUrl || 'https://www.douyin.com/',
  );
  let page = null;
  try {
    page = await waitForPage(port, options.timeoutMs || DEFAULT_TIMEOUT_MS);
    await cdp(page.webSocketDebuggerUrl, 'Page.addScriptToEvaluateOnNewDocument', {
      source: DOUYIN_MEDIA_PROBE_SCRIPT,
    });
    return {
      proc,
      port,
      profileDir,
      page,
      temporaryProfile,
    };
  } catch (error) {
    await stopBrowser(proc, page).catch(() => {});
    if (temporaryProfile) {
      await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    }
    throw error;
  }
}

async function closeDouyinSession(session, options = {}) {
  if (!session) return;
  await stopBrowser(session.proc, session.page);
  if (session.temporaryProfile && !options.keepProfile && session.profileDir) {
    await rm(session.profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

function douyinDimension(info) {
  const width = Number(info?.width) || 0;
  const height = Number(info?.height) || 0;
  return width && height ? Math.min(width, height) : Math.max(width, height);
}

function isProbablyMuxedDouyinSource(item) {
  const source = String(item?.source || '');
  const src = String(item?.src || '');
  if (/\/media-(?:video|audio)-[^/]+\//.test(src)) return false;
  return source === 'play_addr'
    || source === 'play_addr_h264'
    || source === 'download_addr';
}

function douyinTargetQuality(quality) {
  const key = String(quality || 'best').toLowerCase();
  const targetMap = {
    '2k': 1440,
    '1440': 1440,
    '1440p': 1440,
    '1080': 1080,
    '1080p': 1080,
    '720': 720,
    '720p': 720,
    '540': 540,
    '540p': 540,
    '480': 480,
    '480p': 480,
    '360': 360,
    '360p': 360,
  };
  return targetMap[key] || (/^\d{3,4}p?$/.test(key) ? Number(key.replace(/p$/, '')) : null);
}

function selectCachedDouyinInfo(resolved, quality) {
  const base = resolved?.info || {};
  const allCandidates = Array.isArray(base.availableQualities)
    ? base.availableQualities.filter((item) => item?.src)
    : [];
  const sourceRank = (item) => {
    if (item.source === 'play_addr') return 0;
    if (item.source === 'play_addr_h264') return 1;
    if (String(item.source || '').startsWith('bit_rate.')) return 2;
    if (item.source === 'download_addr') return 5;
    return 6;
  };
  const hasWatermark = (item) => /(?:[?&]watermark=1|logo_name=|misc_download_addrs)/i.test(`${item.src || ''} ${item.source || ''}`);
  const muxedCandidates = allCandidates.filter(isProbablyMuxedDouyinSource);
  const cleanCandidates = (muxedCandidates.length ? muxedCandidates : allCandidates)
    .filter((item) => !hasWatermark(item));
  const candidates = cleanCandidates.length ? cleanCandidates : allCandidates;
  if (!candidates.length) return base;

  const key = String(quality || 'best').toLowerCase();
  const target = douyinTargetQuality(key);
  const pixels = (item) => (Number(item.width) || 0) * (Number(item.height) || 0);
  const byBest = (a, b) => pixels(b) - pixels(a)
    || douyinDimension(b) - douyinDimension(a)
    || sourceRank(a) - sourceRank(b)
    || (Number(b.bitRate) || 0) - (Number(a.bitRate) || 0)
    || (Number(b.dataSize) || 0) - (Number(a.dataSize) || 0);
  const byLowest = (a, b) => (Number(a.dataSize) || Number.MAX_SAFE_INTEGER) - (Number(b.dataSize) || Number.MAX_SAFE_INTEGER)
    || pixels(a) - pixels(b)
    || sourceRank(a) - sourceRank(b);
  const byTarget = (a, b) => Math.abs(douyinDimension(a) - target) - Math.abs(douyinDimension(b) - target)
    || (douyinDimension(a) < target ? 1 : 0) - (douyinDimension(b) < target ? 1 : 0)
    || sourceRank(a) - sourceRank(b)
    || (Number(b.bitRate) || 0) - (Number(a.bitRate) || 0)
    || (Number(b.dataSize) || 0) - (Number(a.dataSize) || 0);

  const selected = [...candidates].sort(key === 'lowest' ? byLowest : target ? byTarget : byBest)[0];
  if (!selected) return base;
  return {
    ...base,
    src: selected.src,
    source: selected.source || base.source,
    width: selected.width || base.width,
    height: selected.height || base.height,
    bitRate: selected.bitRate || base.bitRate,
    dataSize: selected.dataSize || base.dataSize,
    selectedQuality: key,
  };
}

function logDouyinInfo(info, options = {}) {
  reportLog(options, `  Title: ${stripDouyinSuffix(info.title) || '(no title)'}`);
  reportLog(options, `  ID: ${info.id}`);
  if (info.duration) {
    reportLog(options, `  Duration: ${Math.round(info.duration)}s`);
  }
  if (info.source) {
    reportLog(options, `  Source type: ${info.source}`);
  }
  if (isPhotoNoteInfo(info)) {
    reportLog(options, `  Photo note: ${info.images.length} images${info.audioSrc ? ' + background audio' : ''}`);
  }
  if (info.availableQualities?.length) {
    const qualities = info.availableQualities
      .map((item) => item.dimension ? `${item.dimension}P` : '')
      .filter(Boolean)
      .join(', ');
    reportLog(options, `  Available qualities: ${qualities}`);
  }
  if (info.width || info.height) {
    const width = Number(info.width) || 0;
    const height = Number(info.height) || 0;
    const selected = width && height ? Math.min(width, height) : Math.max(width, height);
    reportLog(options, `  Selected quality: ${selected ? `${selected}P` : 'unknown'} (${info.width || '?'}x${info.height || '?'})`);
  }
}

async function downloadOne(url, options, browserPath) {
  if (options.douyinResolvedInfo?.info?.src || isPhotoNoteInfo(options.douyinResolvedInfo?.info)) {
    const { cookies = [], pageUrl: cachedPageUrl = '' } = options.douyinResolvedInfo;
    const pageUrl = await resolveDouyinUrl(cachedPageUrl || url, Math.min(options.timeoutMs, 15_000));
    const info = selectCachedDouyinInfo(options.douyinResolvedInfo, options.quality);
    reportLog(options, `Opening: ${url}`);
    reportLog(options, '  使用识别画质时锁定的抖音播放源。');
    logDouyinInfo(info, options);

    if (options.infoOnly) {
      reportLog(options, isPhotoNoteInfo(info) ? `  Images: ${info.images.length}` : `  Source: ${info.src}`);
      return options.douyinResolvedInfo;
    }

    await mkdir(path.resolve(options.outDir), { recursive: true });
    const outputPath = isPhotoNoteInfo(info)
      ? await buildPhotoOutputPath(options.outDir, options.nameTemplate, info, options.overwrite)
      : await buildOutputPath(options.outDir, options.nameTemplate, info, options.overwrite);
    reportLog(options, `  Saving: ${outputPath}`);
    try {
      const saved = isPhotoNoteInfo(info)
        ? await downloadPhotoNote(info, outputPath, pageUrl, cookies, options)
        : await downloadToFile(info, outputPath, pageUrl, cookies, options);
      reportLog(options, `  Done: ${saved.size} bytes`);
      return outputPath;
    } catch (error) {
      if (options.signal?.aborted || /任务已终止|aborted|abort/i.test(String(error?.message || error))) {
        throw error;
      }
      if (isPhotoNoteInfo(info)) {
        await rm(path.dirname(outputPath), { recursive: true, force: true }).catch(() => {});
      } else {
        await rm(outputPath, { force: true }).catch(() => {});
      }
      reportLog(options, '  识别阶段锁定的抖音媒体地址已失效，正在自动重新解析后继续下载。');
      return downloadOne(pageUrl, {
        ...options,
        douyinResolvedInfo: null,
        downloadAttempts: Math.max(3, Number(options.downloadAttempts) || 0),
      }, browserPath);
    }
  }

  const pageUrl = await resolveDouyinUrl(url, Math.min(options.timeoutMs, 15_000));
  const expectedId = extractDouyinId(pageUrl);
  const session = options.douyinSession || null;
  const port = session ? session.port : await getFreePort();
  const temporaryProfile = !session && !options.douyinProfileDir;
  const profileDir = session
    ? session.profileDir
    : options.douyinProfileDir
      ? path.resolve(options.douyinProfileDir)
      : await makeTempDir('douyin-downloader');
  let proc = null;
  let page = session?.page || null;

  reportLog(options, `Opening: ${url}`);
  if (pageUrl !== url) {
    reportLog(options, `  Normalized: ${pageUrl}`);
  }
  try {
    if (!session) {
      proc = await startBrowser(browserPath, port, profileDir, shouldShowBrowser(options));
      page = await waitForPage(port, options.timeoutMs);
      await cdp(page.webSocketDebuggerUrl, 'Page.addScriptToEvaluateOnNewDocument', {
        source: DOUYIN_MEDIA_PROBE_SCRIPT,
      });
    } else {
      reportLog(options, '  使用同一个抖音浏览器窗口继续处理。');
    }
    await resetDouyinPageForSwitch(page);
    await cdp(page.webSocketDebuggerUrl, 'Page.navigate', { url: pageUrl });
    const info = await resolveDouyinVideoInfo(page, options.timeoutMs, options.quality, expectedId);
    const cookieResult = await cdp(page.webSocketDebuggerUrl, 'Network.getAllCookies').catch(() => ({ cookies: [] }));

    logDouyinInfo(info, options);

    if (options.infoOnly) {
      reportLog(options, isPhotoNoteInfo(info) ? `  Images: ${info.images.length}` : `  Source: ${info.src}`);
      return {
        platform: 'douyin',
        info,
        cookies: cookieResult.cookies || [],
        pageUrl,
        capturedAt: Date.now(),
      };
    }

    await mkdir(path.resolve(options.outDir), { recursive: true });
    const outputPath = isPhotoNoteInfo(info)
      ? await buildPhotoOutputPath(options.outDir, options.nameTemplate, info, options.overwrite)
      : await buildOutputPath(options.outDir, options.nameTemplate, info, options.overwrite);
    reportLog(options, `  Saving: ${outputPath}`);
    const saved = isPhotoNoteInfo(info)
      ? await downloadPhotoNote(info, outputPath, pageUrl, cookieResult.cookies || [], options)
      : await downloadToFile(info, outputPath, pageUrl, cookieResult.cookies || [], options);
    reportLog(options, `  Done: ${saved.size} bytes`);
    return outputPath;
  } finally {
    if (!session) {
      await stopBrowser(proc, page);
      if (temporaryProfile && !options.keepProfile) {
        await rm(profileDir, { recursive: true, force: true }).catch(() => {});
      } else if (temporaryProfile) {
        reportLog(options, `  Kept browser profile: ${profileDir}`);
      }
    }
  }
}


function supportsDouyinUrl(url) {
  const candidate = extractDouyinUrls(url)[0] || String(url || '').trim();
  try {
    const parsed = new URL(candidate);
    return parsed.hostname === 'douyin.com' || parsed.hostname.endsWith('.douyin.com');
  } catch {
    return false;
  }
}

const platform = {
  id: 'douyin',
  name: '抖音',
  supports: supportsDouyinUrl,
  downloadOne,
};

export { closeDouyinSession, createDouyinSession, downloadOne, extractDouyinUrls, findBrowser, normalizeDouyinUrl, platform, resolveDouyinUrl };
