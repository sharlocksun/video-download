import { downloadPhotoPost } from '../photo-post.mjs';
import { downloadWithYtDlp, getYtDlpRawInfo, getYtDlpVideoInfo } from '../youtube/index.mjs';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function extractInstagramUrl(value) {
  const text = String(value || '').trim();
  const matched = text.match(/https?:\/\/[^\s<>"']+/iu);
  return (matched?.[0] || text).replace(/[，。；！、）】》]+$/gu, '');
}

function supportsInstagramUrl(value) {
  try {
    const parsed = new URL(extractInstagramUrl(value));
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    return host === 'instagram.com'
      || host.endsWith('.instagram.com')
      || host === 'instagr.am'
      || host.endsWith('.instagr.am');
  } catch {
    return false;
  }
}

function bestThumbnail(entry = {}) {
  const candidates = [
    ...(entry.thumbnails || []),
    entry.thumbnail ? { url: entry.thumbnail, width: entry.width, height: entry.height } : null,
  ].filter((item) => /^https?:\/\//.test(item?.url || ''));
  return candidates.sort((a, b) => (
    (Number(b.width) || 0) * (Number(b.height) || 0)
    - (Number(a.width) || 0) * (Number(a.height) || 0)
  ))[0] || null;
}

function bestVideoFormat(entry = {}) {
  return (entry.formats || [])
    .filter((format) => /^https?:\/\//.test(format?.url || '') && format.vcodec && format.vcodec !== 'none')
    .sort((a, b) => (
      (Number(b.width) || 0) * (Number(b.height) || 0)
      - (Number(a.width) || 0) * (Number(a.height) || 0)
      || (Number(b.filesize) || Number(b.filesize_approx) || 0) - (Number(a.filesize) || Number(a.filesize_approx) || 0)
    ))[0] || null;
}

function instagramPhotoInfoFromRaw(raw, url) {
  const entries = Array.isArray(raw.entries) && raw.entries.length ? raw.entries : [raw];
  const images = [];
  const videos = [];
  for (const entry of entries) {
    const video = bestVideoFormat(entry);
    if (video) {
      videos.push({
        src: video.url,
        alternatives: (entry.formats || []).filter((item) => item?.url && item.vcodec && item.vcodec !== 'none').map((item) => item.url),
        width: Number(video.width) || 0,
        height: Number(video.height) || 0,
        ext: video.ext || 'mp4',
      });
      continue;
    }
    const image = bestThumbnail(entry);
    if (!image) continue;
    images.push({
      src: image.url,
      alternatives: (entry.thumbnails || []).map((item) => item?.url).filter(Boolean),
      width: Number(image.width) || 0,
      height: Number(image.height) || 0,
      ext: 'jpg',
    });
  }
  if (!images.length) throw new Error('该 Instagram 作品不是图片或混合轮播');
  return {
    platform: 'instagram',
    kind: 'photo',
    id: raw.id || url.match(/\/(?:p|reel|reels)\/([^/?#]+)/i)?.[1] || 'instagram',
    title: raw.title || raw.description || `instagram_${raw.id || 'post'}`,
    description: raw.description || '',
    uploader: raw.uploader || raw.channel || '',
    webpageUrl: raw.webpage_url || url,
    images,
    videos,
  };
}

async function getInstagramPhotoInfo(inputUrl, options = {}) {
  const url = extractInstagramUrl(inputUrl);
  const { info: raw } = await getYtDlpRawInfo(url, options, 'Instagram', {
    allowPlaylist: true,
    ignoreNoFormats: true,
  });
  return instagramPhotoInfoFromRaw(raw, url);
}

async function getVideoInfo(inputUrl, options = {}) {
  const url = extractInstagramUrl(inputUrl);
  try {
    return await getInstagramPhotoInfo(url, options);
  } catch {
    return getYtDlpVideoInfo(url, options, 'Instagram');
  }
}

async function downloadOne(inputUrl, options = {}) {
  const url = extractInstagramUrl(inputUrl);
  let info = null;
  try {
    info = await getInstagramPhotoInfo(url, options);
  } catch {
    return downloadWithYtDlp(url, options, 'Instagram', 'instagram');
  }
  const log = (message) => {
    options.onLog?.(message);
    console.log(message);
  };
  log(`Opening: ${url}`);
  log(`  Title: ${info.title || '(no title)'}`);
  log(`  ID: ${info.id}`);
  if (info.uploader) log(`  Uploader: ${info.uploader}`);
  log(`  Carousel: ${info.images.length} images${info.videos.length ? ` + ${info.videos.length} videos` : ''}`);
  if (options.infoOnly) {
    log(`  Images: ${info.images.length}`);
    return { platform: 'instagram', info, pageUrl: url, capturedAt: Date.now() };
  }
  return downloadPhotoPost(info, options, {
    platformName: 'Instagram',
    platformSlug: 'instagram',
    headersForUrl: () => ({
      'User-Agent': USER_AGENT,
      Referer: 'https://www.instagram.com/',
    }),
  });
}

const platform = {
  id: 'instagram',
  name: 'Instagram',
  supports: supportsInstagramUrl,
  downloadOne,
};

export { downloadOne, getInstagramPhotoInfo, getVideoInfo, instagramPhotoInfoFromRaw, platform };
