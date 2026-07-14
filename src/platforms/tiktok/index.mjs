import { downloadWithYtDlp, getYtDlpVideoInfo } from '../youtube/index.mjs';

function supportsTikTokUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    return host === 'tiktok.com'
      || host.endsWith('.tiktok.com')
      || host === 'tiktokv.com'
      || host.endsWith('.tiktokv.com');
  } catch {
    return false;
  }
}

async function getVideoInfo(url, options = {}) {
  return getYtDlpVideoInfo(url, options, 'TikTok');
}

async function downloadOne(url, options = {}) {
  return downloadWithYtDlp(url, options, 'TikTok', 'tiktok');
}

const platform = {
  id: 'tiktok',
  name: 'TikTok',
  supports: supportsTikTokUrl,
  downloadOne,
};

export { downloadOne, getVideoInfo, platform };
