import { downloadPhotoPost } from '../photo-post.mjs';
import { downloadWithYtDlp, getYtDlpVideoInfo } from '../youtube/index.mjs';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function extractXiaohongshuUrl(value) {
  const text = String(value || '').trim();
  const matched = text.match(/https?:\/\/[^\s<>"']+/iu);
  return (matched?.[0] || text).replace(/[，。；！、）】》]+$/gu, '');
}

function supportsXiaohongshuUrl(value) {
  try {
    const parsed = new URL(extractXiaohongshuUrl(value));
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    return host === 'xiaohongshu.com'
      || host.endsWith('.xiaohongshu.com')
      || host === 'xhslink.com'
      || host.endsWith('.xhslink.com')
      || host === 'xhs.cn'
      || host.endsWith('.xhs.cn');
  } catch {
    return false;
  }
}

async function resolveXiaohongshuUrl(inputUrl, options = {}) {
  const url = extractXiaohongshuUrl(inputUrl);
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (!['xhslink.com', 'xhs.cn'].some((domain) => host === domain || host.endsWith(`.${domain}`))) return url;
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT },
      signal: options.signal || AbortSignal.timeout(Math.min(options.timeoutMs || 15_000, 15_000)),
    });
    await response.body?.cancel().catch(() => {});
    return response.url || url;
  } catch {
    return url;
  }
}

function firstDescriptionLine(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
}

function findXiaohongshuNote(state, noteId) {
  const direct = state?.note?.noteDetailMap?.[noteId]?.note;
  if (direct) return direct;
  const seen = new Set();
  const stack = [state];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if (String(current.noteId || '') === noteId && Array.isArray(current.imageList)) return current;
    for (const child of Object.values(current)) {
      if (child && typeof child === 'object') stack.push(child);
    }
  }
  return null;
}

async function getXiaohongshuPhotoInfo(inputUrl, options = {}) {
  const url = await resolveXiaohongshuUrl(inputUrl, options);
  const parsed = new URL(url);
  const noteId = parsed.pathname.match(/\/(?:explore|discovery\/item)\/([\da-f]+)/i)?.[1] || '';
  if (!noteId) throw new Error('没有从小红书链接中识别到笔记 ID');
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    signal: options.signal || AbortSignal.timeout(Math.min(options.timeoutMs || 30_000, 30_000)),
  });
  if (!response.ok) throw new Error(`小红书页面请求返回 HTTP ${response.status}`);
  const html = await response.text();
  const marker = 'window.__INITIAL_STATE__=';
  const start = html.indexOf(marker);
  const end = start >= 0 ? html.indexOf('</script>', start) : -1;
  if (start < 0 || end < 0) throw new Error('小红书页面没有返回笔记数据');
  const rawState = html.slice(start + marker.length, end).trim().replace(/;$/, '');
  const state = JSON.parse(rawState.replace(/\bundefined\b/g, 'null'));
  const note = findXiaohongshuNote(state, noteId);
  if (!note || String(note.type || '').toLowerCase() === 'video' || note.video) {
    throw new Error('该小红书作品不是纯图片笔记');
  }
  const images = (note.imageList || []).map((image) => {
    const variants = [
      ...(image.infoList || []).map((item) => item?.url),
      image.urlDefault,
      image.urlPre,
    ].filter(Boolean).map((item) => String(item).replace(/^http:/i, 'https:'));
    const preferred = (image.infoList || []).find((item) => item?.imageScene === 'WB_DFT')?.url
      || image.urlDefault
      || variants[0];
    return {
      src: String(preferred || '').replace(/^http:/i, 'https:'),
      alternatives: variants,
      width: Number(image.width) || 0,
      height: Number(image.height) || 0,
      ext: 'jpg',
    };
  }).filter((image) => /^https?:\/\//.test(image.src));
  if (!images.length) throw new Error('该小红书笔记没有可下载原图');
  return {
    platform: 'xiaohongshu',
    kind: 'photo',
    id: note.noteId || noteId,
    title: note.title || firstDescriptionLine(note.desc) || `xiaohongshu_${noteId}`,
    description: note.desc || '',
    uploader: note.user?.nickname || '',
    webpageUrl: url,
    images,
  };
}

function logPhotoInfo(info, options = {}) {
  const log = (message) => {
    options.onLog?.(message);
    console.log(message);
  };
  log(`  Title: ${info.title || '(no title)'}`);
  log(`  ID: ${info.id}`);
  if (info.uploader) log(`  Uploader: ${info.uploader}`);
  log(`  Photo note: ${info.images.length} images`);
}

async function getVideoInfo(inputUrl, options = {}) {
  const url = await resolveXiaohongshuUrl(inputUrl, options);
  try {
    return await getXiaohongshuPhotoInfo(url, options);
  } catch {
    return getYtDlpVideoInfo(url, options, '小红书');
  }
}

async function downloadOne(inputUrl, options = {}) {
  const url = await resolveXiaohongshuUrl(inputUrl, options);
  let info = null;
  try {
    info = await getXiaohongshuPhotoInfo(url, options);
  } catch {
    return downloadWithYtDlp(url, options, '小红书', 'xiaohongshu');
  }
  const opening = `Opening: ${url}`;
  options.onLog?.(opening);
  console.log(opening);
  logPhotoInfo(info, options);
  if (options.infoOnly) {
    const message = `  Images: ${info.images.length}`;
    options.onLog?.(message);
    console.log(message);
    return { platform: 'xiaohongshu', info, pageUrl: url, capturedAt: Date.now() };
  }
  return downloadPhotoPost(info, options, {
    platformName: '小红书',
    platformSlug: 'xiaohongshu',
    headersForUrl: () => ({
      'User-Agent': USER_AGENT,
      Referer: url,
    }),
  });
}

const platform = {
  id: 'xiaohongshu',
  name: '小红书',
  supports: supportsXiaohongshuUrl,
  downloadOne,
};

export { downloadOne, getVideoInfo, getXiaohongshuPhotoInfo, platform };
