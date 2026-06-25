import { createWriteStream } from 'node:fs';
import { access, mkdir, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { cdp, cookiesToHeader, getAllCookies, startCdpBrowser } from '../../core/cdp-browser.mjs';
import { makeTempDir } from '../../core/temp-dir.mjs';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function supportsKuaishouUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    return host === 'kuaishou.com'
      || host.endsWith('.kuaishou.com')
      || host === 'kuaishouapp.com'
      || host.endsWith('.kuaishouapp.com')
      || host === 'gifshow.com'
      || host.endsWith('.gifshow.com')
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

function guessId(...values) {
  for (const value of values) {
    const text = String(value || '');
    const photoId = text.match(/photoId=([^&]+)/i);
    if (photoId) return photoId[1];
    const shortVideo = text.match(/short-video\/([^/?#]+)/i);
    if (shortVideo) return shortVideo[1];
  }
  return `${Date.now()}`;
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
  const headers = {
    Referer: info.href,
    'User-Agent': USER_AGENT,
    Range: 'bytes=0-',
  };
  const cookieHeader = cookiesToHeader(cookies, new URL(info.src).hostname);
  if (cookieHeader) headers.Cookie = cookieHeader;

  const response = await fetch(info.src, { headers, signal: options.signal });
  if (!response.ok && response.status !== 206) {
    throw new Error(`视频请求返回 HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error('视频响应没有可读取内容');
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

async function createKuaishouSession(browserPath, options = {}) {
  const profileDir = await makeTempDir('muxin-kuaishou-batch');
  const browser = await startCdpBrowser(browserPath, {
    url: 'about:blank',
    profileDir,
    showBrowser: true,
    timeoutMs: options.timeoutMs || 180_000,
    pagePredicate: (page) => page.type === 'page',
  });
  return browser;
}

async function closeKuaishouSession(session, options = {}) {
  if (!session) return;
  if (session.proc && !session.proc.killed) {
    session.proc.kill();
  }
  if (!options.keepProfile && session.profileDir) {
    await rm(session.profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function downloadOne(url, options = {}, browserPath) {
  if (options.kuaishouResolvedInfo?.info?.src) {
    const { info, cookies = [] } = options.kuaishouResolvedInfo;
    reportLog(options, `Opening: ${url}`);
    reportLog(options, '  使用识别画质时锁定的快手播放源。');
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
      return options.kuaishouResolvedInfo;
    }

    await mkdir(path.resolve(options.outDir), { recursive: true });
    const outputPath = await buildOutputPath(options.outDir, options.nameTemplate, info, options.overwrite);
    reportLog(options, `  Saving: ${outputPath}`);
    const saved = await downloadToFile(info, outputPath, cookies, options);
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

export { closeKuaishouSession, createKuaishouSession, downloadOne, getVideoInfo, platform };
