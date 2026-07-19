import { createWriteStream } from 'node:fs';
import { access, mkdir, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { cdp, cookiesToHeader, getAllCookies, startCdpBrowser } from '../../core/cdp-browser.mjs';
import { makeTempDir } from '../../core/temp-dir.mjs';
import { downloadPhotoPost, isPhotoPostInfo } from '../photo-post.mjs';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Version/16.0 Mobile/15E148 Safari/604.1';
const KUAISHOU_PHOTO_API = 'https://m.gifshow.com/rest/wd/ugH5App/photo/simple/info';

function extractKuaishouUrl(value) {
  const text = String(value || '').trim();
  const matched = text.match(/https?:\/\/[^\s<>"']+/iu);
  return (matched?.[0] || text).replace(/[，。；！、）】》]+$/gu, '');
}

function supportsKuaishouUrl(value) {
  try {
    const parsed = new URL(extractKuaishouUrl(value));
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    return host === 'kuaishou.com'
      || host.endsWith('.kuaishou.com')
      || host === 'kuaishouapp.com'
      || host.endsWith('.kuaishouapp.com')
      || host === 'gifshow.com'
      || host.endsWith('.gifshow.com')
      || host === 'chenzhongtech.com'
      || host.endsWith('.chenzhongtech.com')
      || host === 'kwai.com'
      || host.endsWith('.kwai.com')
      || host === 'ks.com'
      || host.endsWith('.ks.com');
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sanitizeFilePart(value, fallback = 'untitled', maxLength = 120) {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+$/, '');

  return (cleaned || fallback).slice(0, maxLength);
}

function extractKuaishouPhotoId(...values) {
  for (const value of values) {
    const text = String(value || '');
    const photoId = text.match(/photoId=([^&]+)/i);
    if (photoId) return photoId[1];
    const shortVideo = text.match(/short-video\/([^/?#]+)/i);
    if (shortVideo) return shortVideo[1];
    const fwPhoto = text.match(/\/fw\/photo\/([^/?#]+)/i);
    if (fwPhoto) return fwPhoto[1];
  }
  return '';
}

function guessId(...values) {
  const photoId = extractKuaishouPhotoId(...values);
  if (photoId) return photoId;
  return `${Date.now()}`;
}

async function resolveKuaishouPhotoId(inputUrl, options = {}) {
  const url = extractKuaishouUrl(inputUrl);
  const direct = extractKuaishouPhotoId(url);
  if (direct) return direct;
  let current = url;
  for (let index = 0; index < 6; index += 1) {
    try {
      const response = await fetch(current, {
        redirect: 'manual',
        headers: { 'User-Agent': MOBILE_USER_AGENT, Referer: 'https://v.chenzhongtech.com/' },
        signal: options.signal || AbortSignal.timeout(Math.min(options.timeoutMs || 15_000, 15_000)),
      });
      await response.body?.cancel().catch(() => {});
      const fromResponse = extractKuaishouPhotoId(response.url);
      if (fromResponse) return fromResponse;
      const location = response.headers.get('location');
      if (!location) break;
      current = new URL(location, current).href;
      const fromLocation = extractKuaishouPhotoId(current);
      if (fromLocation) return fromLocation;
    } catch {
      break;
    }
  }
  throw new Error('没有从快手链接中识别到 photoId');
}

function absoluteKuaishouCdnUrl(cdn, resourcePath) {
  const rawPath = String(resourcePath || '');
  if (/^https?:\/\//i.test(rawPath)) return rawPath;
  const rawCdn = String(cdn || '').replace(/\/$/, '');
  const base = /^https?:\/\//i.test(rawCdn) ? rawCdn : `https://${rawCdn}`;
  return `${base}/${rawPath.replace(/^\//, '')}`;
}

function kuaishouFormatSide(format = {}) {
  const width = Number(format.width) || 0;
  const height = Number(format.height) || 0;
  if (width && height) return Math.min(width, height);
  return height || width || 0;
}

function selectKuaishouVideoInfo(info, quality = 'best') {
  const formats = (info.formats || []).filter((item) => /^https?:\/\//.test(item?.src || ''));
  if (!formats.length) return info;
  const key = String(quality || 'best').toLowerCase();
  const target = key === 'lowest'
    ? -1
    : /^\d{3,4}p?$/.test(key) ? Number(key.replace(/p$/, ''))
      : key === '4k' ? 2160
        : key === '2k' ? 1440
          : null;
  const ranked = [...formats].sort((a, b) => (
    kuaishouFormatSide(b) - kuaishouFormatSide(a)
    || Number(b.bitrate || 0) - Number(a.bitrate || 0)
    || Number(String(b.codec || '').toLowerCase() === 'avc') - Number(String(a.codec || '').toLowerCase() === 'avc')
  ));
  let selected;
  if (target === -1) {
    selected = ranked[ranked.length - 1];
  } else if (target) {
    selected = ranked.find((item) => kuaishouFormatSide(item) <= target) || ranked[ranked.length - 1];
  } else {
    selected = ranked[0];
  }
  return {
    ...info,
    ...selected,
    formats,
  };
}

function kuaishouVideoFormats(photo = {}) {
  const formats = [];
  const add = (item) => {
    if (!/^https?:\/\//.test(item?.src || '') || !/\.mp4(?:\?|$)/i.test(item.src)) return;
    if (formats.some((current) => current.src === item.src)) return;
    formats.push(item);
  };
  const mainUrls = (photo.mainMvUrls || []).map((item) => item?.url || item).filter(Boolean);
  if (mainUrls.length) {
    add({
      src: mainUrls[0],
      alternatives: mainUrls.slice(1),
      width: Number(photo.width) || 0,
      height: Number(photo.height) || 0,
      bitrate: 0,
      codec: 'avc',
      qualityLabel: '原始视频',
    });
  }
  for (const adaptation of photo.manifest?.adaptationSet || []) {
    for (const representation of adaptation.representation || []) {
      add({
        src: representation.url,
        alternatives: representation.backupUrl || [],
        width: Number(representation.width) || 0,
        height: Number(representation.height) || 0,
        bitrate: Number(representation.avgBitrate || representation.maxBitrate) || 0,
        codec: representation.videoCodec || '',
        qualityLabel: representation.qualityType || representation.qualityLabel || '',
      });
    }
  }
  return formats;
}

async function getKuaishouApiInfo(inputUrl, options = {}) {
  const url = extractKuaishouUrl(inputUrl);
  const photoId = await resolveKuaishouPhotoId(url, options);
  const response = await fetch(KUAISHOU_PHOTO_API, {
    method: 'POST',
    headers: {
      'User-Agent': MOBILE_USER_AGENT,
      Referer: 'https://v.chenzhongtech.com/',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ photoId, subBiz: 'BROWSE_SLIDE_PHOTO', kpn: 'KUAISHOU' }),
    signal: options.signal || AbortSignal.timeout(Math.min(options.timeoutMs || 30_000, 30_000)),
  });
  if (!response.ok) throw new Error(`快手图集接口返回 HTTP ${response.status}`);
  const data = await response.json();
  if (data.result !== undefined && data.result !== 1) throw new Error(`快手图集接口返回：${data.message || data.result}`);
  const photo = data.photo || {};
  const photoType = String(photo.photoType || '');
  let images = [];
  let audioSrc = '';
  if (photoType === 'SINGLE_PICTURE') {
    const cover = (photo.coverUrls || []).map((item) => item?.url || item).find(Boolean);
    if (cover) images = [{ src: cover, alternatives: [], width: 0, height: 0, ext: 'jpg' }];
  } else if (['HORIZONTAL_ATLAS', 'VERTICAL_ATLAS'].includes(photoType)) {
    const atlas = data.atlas || {};
    const cdn = (atlas.cdnList || []).map((item) => item?.cdn || item).find(Boolean);
    images = (atlas.list || []).map((item, index) => ({
      src: absoluteKuaishouCdnUrl(cdn, item),
      alternatives: [],
      width: Number(atlas.size?.[index]?.w) || 0,
      height: Number(atlas.size?.[index]?.h) || 0,
      ext: /\.webp(?:$|\?)/i.test(item) ? 'webp' : 'jpg',
    }));
    const musicCdn = (atlas.musicCdnList || []).map((item) => item?.cdn || item).find(Boolean);
    if (atlas.music && musicCdn) audioSrc = absoluteKuaishouCdnUrl(musicCdn, atlas.music);
  } else if (photoType === 'VIDEO') {
    const formats = kuaishouVideoFormats(photo);
    if (!formats.length) throw new Error('快手接口没有返回可直接下载的 MP4 视频源');
    const availableQualities = [...new Set(formats.map(kuaishouFormatSide).filter(Boolean))]
      .sort((a, b) => b - a)
      .map((item) => `${item}P`)
      .join(', ');
    return selectKuaishouVideoInfo({
      platform: 'kuaishou',
      kind: 'video',
      id: photoId,
      internalId: photo.photoId || '',
      title: photo.caption || `kuaishou_${photoId}`,
      uploader: photo.userName || '',
      duration: Number(photo.duration) > 1000 ? Number(photo.duration) / 1000 : Number(photo.duration) || null,
      href: url,
      webpageUrl: url,
      source: 'kuaishou_api',
      availableQualities,
      formats,
    }, options.quality);
  } else {
    throw new Error(`快手接口返回了不支持的作品类型：${photoType || 'UNKNOWN'}`);
  }
  if (!images.length) throw new Error('快手图集没有返回可下载图片');
  return {
    platform: 'kuaishou',
    kind: 'photo',
    id: photoId,
    internalId: photo.photoId || '',
    title: photo.caption || `kuaishou_${photoId}`,
    uploader: photo.userName || '',
    webpageUrl: url,
    images,
    audioSrc,
  };
}

async function getKuaishouPhotoInfo(inputUrl, options = {}) {
  const info = await getKuaishouApiInfo(inputUrl, options);
  if (!isPhotoPostInfo(info)) throw new Error(`该快手作品不是图片图集：${info.kind || 'VIDEO'}`);
  return info;
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
  const title = sanitizeFilePart(info.title, 'kuaishou', 80);
  const id = sanitizeFilePart(info.id, 'video');
  const fileName = template
    .replaceAll('%id%', id)
    .replaceAll('%title%', title)
    .replaceAll('%date%', date);

  const safeFileName = sanitizeFilePart(fileName, `kuaishou_${id}.mp4`);
  const withExt = path.extname(safeFileName) ? safeFileName : `${safeFileName}.mp4`;
  return getUniquePath(path.resolve(outDir, withExt), overwrite);
}

async function getVideoInfo(page, timeoutMs, options = {}) {
  const expression = `(() => {
    const media = [];
    const add = (src, source, extra = {}) => {
      if (/^https?:\\/\\//.test(src || '')) media.push({ src, source, ...extra });
    };
    for (const video of document.querySelectorAll('video')) {
      try { video.muted = true; video.play && video.play().catch(() => {}); } catch {}
      add(video.currentSrc || video.src || '', 'video', {
        duration: Number.isFinite(video.duration) ? video.duration : null,
        readyState: video.readyState,
        width: Number(video.videoWidth) || null,
        height: Number(video.videoHeight) || null
      });
    }
    for (const source of document.querySelectorAll('source[src]')) {
      add(source.src, 'source');
    }
    for (const entry of performance.getEntriesByType('resource')) {
      add(entry.name || '', 'performance');
    }
    const isMediaLike = (src) => /\\.mp4(?:\\?|$)|\\.m3u8(?:\\?|$)|mime_type=video|type=video|\\/video\\//i.test(src || '');
    const isStaticAsset = (src) => /\\.(ico|css|js|json|jpg|jpeg|png|webp|gif|svg|woff2?|ttf)(?:\\?|$)|favicon|sprite|poster|cover|avatar/i.test(src || '');
    const scored = media
      .filter((item) => isMediaLike(item.src) && !isStaticAsset(item.src))
      .map((item) => {
        let score = 0;
        if (/\\.mp4(?:\\?|$)/i.test(item.src)) score += 100;
        if (/\\.m3u8(?:\\?|$)/i.test(item.src)) score += 80;
        if (/video/i.test(item.src)) score += 40;
        if (/kuaishou|gifshow|kwai|kwaicdn|kscdn/i.test(item.src)) score += 80;
        if (item.duration && item.duration > 3) score += 30;
        return { ...item, score };
      })
      .sort((a, b) => b.score - a.score);
    const source = scored.find((item) => item.score > 0);
    return {
      href: location.href,
      title: document.title,
      src: source ? source.src : '',
      duration: source ? source.duration : null,
      source: source ? source.source : '',
      candidates: scored.slice(0, 8),
      text: document.body ? document.body.innerText.slice(0, 500) : ''
    };
  })()`;

  const deadline = Date.now() + timeoutMs;
  const reloadAt = Date.now() + Math.min(10_000, Math.max(4_000, Math.floor(timeoutMs / 4)));
  let lastInfo = null;
  let reloaded = false;
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
    const pageText = String(lastInfo?.text || '');
    if (/captcha|验证码|ANTICRAWL|result["']?\s*:\s*2/i.test(pageText)) {
      throw new Error('快手要求验证码/登录验证。请在可见浏览器中完成验证后，再重新下载这个链接。');
    }
    if (!reloaded && Date.now() >= reloadAt) {
      reloaded = true;
      reportLog(options, '  快手页面首次未返回播放源，已自动刷新一次...');
      await cdp(page.webSocketDebuggerUrl, 'Page.reload', { ignoreCache: true }).catch(() => {});
      await sleep(2500);
      continue;
    }
    await sleep(1000);
  }

  const title = lastInfo?.title ? ` Last page title: ${lastInfo.title}` : '';
  const pageText = String(lastInfo?.text || '');
  if (/captcha|验证码|ANTICRAWL|result["']?\\s*:\\s*2/i.test(pageText)) {
    throw new Error('快手要求验证码/登录验证。请在可见浏览器中完成验证后，再重新下载这个链接。');
  }
  throw new Error(`没有在快手页面中找到可下载的视频播放源。${title}`);
}

async function downloadToFile(info, outputPath, cookies, options = {}) {
  if (options.signal?.aborted) {
    throw new Error('任务已终止');
  }
  let lastError = null;
  for (const source of [...new Set([info.src, ...(info.alternatives || [])].filter(Boolean))]) {
    try {
      const headers = {
        Referer: info.href,
        'User-Agent': USER_AGENT,
        Range: 'bytes=0-',
      };
      const cookieHeader = cookiesToHeader(cookies, new URL(source).hostname);
      if (cookieHeader) headers.Cookie = cookieHeader;
      const response = await fetch(source, { headers, signal: options.signal });
      if (!response.ok && response.status !== 206) throw new Error(`视频请求返回 HTTP ${response.status}`);
      if (!response.body) throw new Error('视频响应没有可读取内容');
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
          if (!file.write(Buffer.from(value))) await once(file, 'drain');
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
    } catch (error) {
      lastError = error;
      await rm(outputPath, { force: true }).catch(() => {});
      if (options.signal?.aborted) throw error;
    }
  }
  throw lastError || new Error('没有可用的快手视频地址');
}

async function createKuaishouSession(browserPath, options = {}) {
  const profileDir = options.profileDir || await makeTempDir('muxin-kuaishou-batch');
  const browser = await startCdpBrowser(browserPath, {
    url: 'about:blank',
    profileDir,
    showBrowser: true,
    timeoutMs: options.timeoutMs || 180_000,
    pagePredicate: (page) => page.type === 'page',
  });
  return {
    ...browser,
    persistentProfile: Boolean(options.keepProfile || options.profileDir),
  };
}

async function closeKuaishouSession(session, options = {}) {
  if (!session) return;
  if (session.proc && !session.proc.killed) {
    session.proc.kill();
  }
  if (!options.keepProfile && !session.persistentProfile && session.profileDir) {
    await rm(session.profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function downloadOne(inputUrl, options = {}, browserPath) {
  const url = extractKuaishouUrl(inputUrl);
  let resolvedInfo = hasUsableKuaishouInfo(options.kuaishouResolvedInfo?.info)
    ? options.kuaishouResolvedInfo
    : null;
  if (!resolvedInfo) {
    try {
      resolvedInfo = {
        platform: 'kuaishou',
        info: await getKuaishouApiInfo(url, options),
        pageUrl: url,
        capturedAt: Date.now(),
      };
    } catch {}
  }
  const photoInfo = isPhotoPostInfo(resolvedInfo?.info) ? resolvedInfo.info : null;
  if (photoInfo) {
    reportLog(options, `Opening: ${url}`);
    reportLog(options, `  Title: ${photoInfo.title || '(no title)'}`);
    reportLog(options, `  ID: ${photoInfo.id}`);
    if (photoInfo.uploader) reportLog(options, `  Uploader: ${photoInfo.uploader}`);
    reportLog(options, `  Photo atlas: ${photoInfo.images.length} images${photoInfo.audioSrc ? ' + background audio' : ''}`);
    if (options.infoOnly) {
      reportLog(options, `  Images: ${photoInfo.images.length}`);
      return options.kuaishouResolvedInfo || { platform: 'kuaishou', info: photoInfo, pageUrl: url, capturedAt: Date.now() };
    }
    return downloadPhotoPost(photoInfo, options, {
      platformName: '快手',
      platformSlug: 'kuaishou',
      headersForUrl: () => ({
        'User-Agent': MOBILE_USER_AGENT,
        Referer: 'https://v.chenzhongtech.com/',
      }),
    });
  }
  if (resolvedInfo?.info?.src) {
    let info = selectKuaishouVideoInfo(resolvedInfo.info, options.quality);
    const { cookies = [] } = resolvedInfo;
    reportLog(options, `Opening: ${url}`);
    reportLog(options, info.source === 'kuaishou_api'
      ? '  使用快手接口返回的播放源，不打开浏览器页面。'
      : '  使用识别画质时锁定的快手播放源。');
    reportLog(options, `  Title: ${info.title || '(no title)'}`);
    reportLog(options, `  ID: ${info.id}`);
    if (info.duration) reportLog(options, `  Duration: ${Math.round(info.duration)}s`);
    if (info.availableQualities) {
      reportLog(options, `  Available qualities: ${info.availableQualities}`);
    } else if (info.height || info.width) {
      const dimension = Math.min(Number(info.width) || 0, Number(info.height) || 0)
        || Math.max(Number(info.width) || 0, Number(info.height) || 0);
      if (dimension) reportLog(options, `  Available qualities: ${dimension}P`);
    }
    reportLog(options, `  Source type: kuaishou ${info.source || 'media'}`);

    if (options.infoOnly) {
      reportLog(options, `  Source: ${info.src}`);
      return { ...resolvedInfo, info };
    }

    await mkdir(path.resolve(options.outDir), { recursive: true });
    const outputPath = await buildOutputPath(options.outDir, options.nameTemplate, info, options.overwrite);
    reportLog(options, `  Saving: ${outputPath}`);
    let saved;
    try {
      saved = await downloadToFile(info, outputPath, cookies, options);
    } catch (error) {
      if (info.source !== 'kuaishou_api' || options.signal?.aborted) throw error;
      reportLog(options, '  快手接口媒体地址已失效，正在重新获取后继续下载。');
      info = selectKuaishouVideoInfo(await getKuaishouApiInfo(url, options), options.quality);
      saved = await downloadToFile(info, outputPath, [], options);
    }
    reportLog(options, `  Done: ${saved.size} bytes`);
    return outputPath;
  }

  if (!browserPath) {
    throw new Error('没有找到 Chrome/Edge，无法解析快手页面');
  }

  const session = options.kuaishouSession || null;
  const profileDir = session ? session.profileDir : await makeTempDir('muxin-kuaishou');
  let browser = session || null;
  reportLog(options, `Opening: ${url}`);

  try {
    if (session) {
      reportLog(options, '  使用同一个快手浏览器窗口继续处理。');
      await cdp(browser.page.webSocketDebuggerUrl, 'Page.navigate', { url });
      await sleep(1500);
    } else {
      browser = await startCdpBrowser(browserPath, {
        url,
        profileDir,
        showBrowser: true,
        timeoutMs: options.timeoutMs || 180_000,
        pagePredicate: (page) => page.type === 'page',
      });
      reportLog(options, '  已打开快手页面；如果页面出现验证码或登录提示，请先手动完成。');
    }
    const info = await getVideoInfo(browser.page, options.timeoutMs || 180_000, options);
    const cookies = await getAllCookies(browser.page).catch(() => []);

    reportLog(options, `  Title: ${info.title || '(no title)'}`);
    reportLog(options, `  ID: ${info.id}`);
    if (info.duration) reportLog(options, `  Duration: ${Math.round(info.duration)}s`);
    if (info.height || info.width) {
      const dimension = Math.min(Number(info.width) || 0, Number(info.height) || 0)
        || Math.max(Number(info.width) || 0, Number(info.height) || 0);
      if (dimension) reportLog(options, `  Available qualities: ${dimension}P`);
    }
    reportLog(options, `  Source type: kuaishou ${info.source || 'media'}`);

    if (options.infoOnly) {
      reportLog(options, `  Source: ${info.src}`);
      return {
        platform: 'kuaishou',
        info,
        cookies,
        capturedAt: Date.now(),
      };
    }

    await mkdir(path.resolve(options.outDir), { recursive: true });
    const outputPath = await buildOutputPath(options.outDir, options.nameTemplate, info, options.overwrite);
    reportLog(options, `  Saving: ${outputPath}`);
    const saved = await downloadToFile(info, outputPath, cookies, options);
    reportLog(options, `  Done: ${saved.size} bytes`);
    return outputPath;
  } finally {
    if (!session) {
      if (browser?.proc && !browser.proc.killed) {
        browser.proc.kill();
      }
      await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

const platform = {
  id: 'kuaishou',
  name: '快手',
  supports: supportsKuaishouUrl,
  downloadOne,
};

function hasUsableKuaishouInfo(info) {
  return Boolean(info?.src || isPhotoPostInfo(info));
}

export { closeKuaishouSession, createKuaishouSession, downloadOne, getKuaishouApiInfo, getKuaishouPhotoInfo, getVideoInfo, platform };
