import { downloadPhotoPost } from '../photo-post.mjs';
import { downloadWithYtDlp, getYtDlpVideoInfo } from '../youtube/index.mjs';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';

function extractTikTokUrl(value) {
  const text = String(value || '').trim();
  const matched = text.match(/https?:\/\/[^\s<>"']+/iu);
  return (matched?.[0] || text).replace(/[，。；！、）】》]+$/gu, '');
}

function supportsTikTokUrl(value) {
  try {
    const parsed = new URL(extractTikTokUrl(value));
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    return host === 'tiktok.com'
      || host.endsWith('.tiktok.com')
      || host === 'tiktokv.com'
      || host.endsWith('.tiktokv.com');
  } catch {
    return false;
  }
}

async function resolveTikTokUrl(inputUrl, options = {}) {
  const url = extractTikTokUrl(inputUrl);
  try {
    const parsed = new URL(url);
    if (!['vm.tiktok.com', 'vt.tiktok.com'].includes(parsed.hostname.toLowerCase())) return url;
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

async function getTikTokPhotoInfo(inputUrl, options = {}) {
  const resolvedUrl = await resolveTikTokUrl(inputUrl, options);
  const postId = resolvedUrl.match(/\/(?:video|photo)\/(\d+)/i)?.[1] || '';
  if (!postId) throw new Error('没有从 TikTok 链接中识别到作品 ID');
  const canonicalVideoUrl = `https://www.tiktok.com/@i/video/${postId}`;
  const candidates = [
    { url: canonicalVideoUrl, userAgent: USER_AGENT },
    { url: resolvedUrl, userAgent: MOBILE_USER_AGENT },
    { url: canonicalVideoUrl, userAgent: MOBILE_USER_AGENT },
    { url: `https://www.tiktok.com/@i/photo/${postId}`, userAgent: MOBILE_USER_AGENT },
  ];
  let detail = null;
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.url, {
        headers: {
          'User-Agent': candidate.userAgent,
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: options.signal || AbortSignal.timeout(Math.min(options.timeoutMs || 30_000, 30_000)),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const marker = '__UNIVERSAL_DATA_FOR_REHYDRATION__';
      const markerAt = html.indexOf(marker);
      const start = markerAt >= 0 ? html.indexOf('>', markerAt) + 1 : -1;
      const end = start > 0 ? html.indexOf('</script>', start) : -1;
      if (start <= 0 || end < 0) throw new Error('页面没有返回作品数据');
      const data = JSON.parse(html.slice(start, end));
      const detailResult = data?.__DEFAULT_SCOPE__?.['webapp.video-detail'];
      detail = detailResult?.itemInfo?.itemStruct || null;
      if (!detail || detailResult?.statusMsg) {
        throw new Error(detailResult?.statusMsg || '页面没有返回作品详情');
      }
      break;
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) throw error;
      detail = null;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  if (!detail) throw new Error(`TikTok 作品数据不可用：${lastError?.message || '没有返回作品详情'}`);
  const rawImages = detail.imagePost?.images || [];
  const images = rawImages.map((image) => {
    const variants = (image?.imageURL?.urlList || []).filter(Boolean);
    return {
      src: variants.find((item) => /\.jpe?g(?:\?|$)/i.test(item)) || variants[0] || '',
      alternatives: variants,
      width: Number(image?.imageWidth || image?.imageURL?.width) || 0,
      height: Number(image?.imageHeight || image?.imageURL?.height) || 0,
      ext: 'jpg',
    };
  }).filter((image) => /^https?:\/\//.test(image.src));
  if (!images.length) throw new Error('该 TikTok 作品不是图片轮播');
  return {
    platform: 'tiktok',
    kind: 'photo',
    id: detail.id || postId,
    title: detail.desc || `tiktok_${postId}`,
    uploader: detail.author?.uniqueId || detail.author?.nickname || '',
    webpageUrl: resolvedUrl,
    images,
    audioSrc: detail.music?.playUrl || '',
    duration: Number(detail.music?.duration) || 0,
  };
}

async function getVideoInfo(inputUrl, options = {}) {
  const url = await resolveTikTokUrl(inputUrl, options);
  try {
    return await getTikTokPhotoInfo(url, options);
  } catch {
    return getYtDlpVideoInfo(url, options, 'TikTok');
  }
}

async function downloadOne(inputUrl, options = {}) {
  const url = await resolveTikTokUrl(inputUrl, options);
  const resolved = options.tiktokResolvedInfo || null;
  if (resolved?.info?.rawInfo) {
    return downloadWithYtDlp(url, {
      ...options,
      ytDlpResolvedInfo: resolved,
    }, 'TikTok', 'tiktok');
  }
  let info = resolved?.info?.kind === 'photo' ? resolved.info : null;
  if (!info) {
    try {
      info = await getTikTokPhotoInfo(url, options);
    } catch {
      return downloadWithYtDlp(url, options, 'TikTok', 'tiktok');
    }
  }
  const log = (message) => {
    options.onLog?.(message);
    console.log(message);
  };
  log(`Opening: ${url}`);
  if (resolved?.info?.kind === 'photo') {
    log('  使用识别画质时锁定的 TikTok 图集，不再重新解析页面。');
  }
  log(`  Title: ${info.title || '(no title)'}`);
  log(`  ID: ${info.id}`);
  if (info.uploader) log(`  Uploader: ${info.uploader}`);
  log(`  Photo post: ${info.images.length} images${info.audioSrc ? ' + background audio' : ''}`);
  if (options.infoOnly) {
    log(`  Images: ${info.images.length}`);
    return { platform: 'tiktok', info, pageUrl: url, capturedAt: Date.now() };
  }
  return downloadPhotoPost(info, options, {
    platformName: 'TikTok',
    platformSlug: 'tiktok',
    omitReferer: true,
    headersForUrl: () => ({
      'User-Agent': USER_AGENT,
    }),
  });
}

const platform = {
  id: 'tiktok',
  name: 'TikTok',
  supports: supportsTikTokUrl,
  downloadOne,
};

export { downloadOne, getTikTokPhotoInfo, getVideoInfo, platform };
